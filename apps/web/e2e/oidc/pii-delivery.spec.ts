import type { APIRequestContext } from "@playwright/test";

import crypto from "node:crypto";

import { expect, test } from "@playwright/test";
import { decodeJwt } from "jose";

import { createDpopProof, createIssuerSession } from "./oidc-helpers";

const RAW_BASE_URL =
  process.env.PLAYWRIGHT_TEST_BASE_URL ?? "http://localhost:3000";
const BASE_URL = RAW_BASE_URL.replace(/\/+$/, "");
const AUTH_BASE_URL = `${BASE_URL}/api/auth`;
const ORIGIN_HEADERS = {
  Origin: BASE_URL,
  "Content-Type": "application/json",
};

const CIBA_GRANT_TYPE = "urn:openid:params:grant-type:ciba";
const TOKEN_URL = `${AUTH_BASE_URL}/oauth2/token`;
const USERINFO_URL = `${AUTH_BASE_URL}/oauth2/userinfo`;

/** PII fields that must NEVER appear in id_tokens. */
const PII_FIELDS = [
  "name",
  "given_name",
  "family_name",
  "birthdate",
  "address",
  "document_number",
  "document_type",
  "issuing_country",
  "nationality",
  "nationalities",
] as const;

async function registerCibaClient(request: APIRequestContext) {
  const res = await request.post(`${AUTH_BASE_URL}/oauth2/register`, {
    data: {
      client_name: `pii-e2e-${crypto.randomUUID().slice(0, 8)}`,
      redirect_uris: ["http://localhost/cb"],
      grant_types: [CIBA_GRANT_TYPE],
      token_endpoint_auth_method: "none",
    },
    headers: ORIGIN_HEADERS,
  });
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as { client_id: string };
  return body.client_id;
}

test.describe("PII delivery via userinfo (CIBA flow)", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("CIBA flow: userinfo returns identity PII, id_token contains zero PII fields", async ({
    request,
  }) => {
    // 1. Create authenticated session
    const session = await createIssuerSession(request);

    // 2. DCR-register a CIBA client
    const clientId = await registerCibaClient(request);

    // 3. Initiate CIBA backchannel auth with identity scopes
    const bcRes = await request.post(`${AUTH_BASE_URL}/oauth2/bc-authorize`, {
      data: {
        client_id: clientId,
        login_hint: session.email,
        scope: "openid identity.name identity.dob",
        binding_message: "PII delivery E2E test",
        resource: BASE_URL,
      },
      headers: ORIGIN_HEADERS,
    });
    expect(bcRes.ok()).toBeTruthy();
    const { auth_req_id } = (await bcRes.json()) as { auth_req_id: string };
    expect(auth_req_id).toBeTruthy();

    // 4. Get intent token for PII staging
    const intentRes = await request.post(
      `${BASE_URL}/api/ciba/identity/intent`,
      {
        data: {
          auth_req_id,
          scopes: ["identity.name", "identity.dob"],
        },
        headers: { Cookie: session.cookieHeader, ...ORIGIN_HEADERS },
      }
    );
    expect(intentRes.ok()).toBeTruthy();
    const { intent_token } = (await intentRes.json()) as {
      intent_token: string;
    };

    // 5. Stage identity claims (simulates vault unlock + PII submission)
    const stageRes = await request.post(`${BASE_URL}/api/ciba/identity/stage`, {
      data: {
        auth_req_id,
        scopes: ["identity.name", "identity.dob"],
        identity: {
          given_name: "Ada",
          family_name: "Lovelace",
          name: "Ada Lovelace",
          birthdate: "1815-12-10",
        },
        intent_token,
      },
      headers: { Cookie: session.cookieHeader, ...ORIGIN_HEADERS },
    });
    expect(stageRes.ok()).toBeTruthy();
    const stageBody = (await stageRes.json()) as { staged: boolean };
    expect(stageBody.staged).toBe(true);

    // 6. Approve the CIBA request
    const approveRes = await request.post(`${AUTH_BASE_URL}/ciba/authorize`, {
      data: { auth_req_id },
      headers: { Cookie: session.cookieHeader, ...ORIGIN_HEADERS },
    });
    expect(approveRes.ok()).toBeTruthy();

    // 7. Poll for tokens (with DPoP)
    const dpop = await createDpopProof({
      method: "POST",
      url: TOKEN_URL,
    });

    const tokenRes = await request.post(TOKEN_URL, {
      form: {
        grant_type: CIBA_GRANT_TYPE,
        auth_req_id,
        client_id: clientId,
        resource: BASE_URL,
      },
      headers: { Origin: BASE_URL, DPoP: dpop.proof },
    });
    if (!tokenRes.ok()) {
      throw new Error(
        `token exchange failed (${tokenRes.status()} ${tokenRes.statusText()}): ${await tokenRes.text()}`
      );
    }
    const tokenBody = (await tokenRes.json()) as {
      access_token: string;
      id_token?: string;
    };
    expect(tokenBody.access_token).toBeTruthy();

    // 8. Assert: id_token contains ZERO identity PII fields
    if (tokenBody.id_token) {
      const idTokenPayload = decodeJwt(tokenBody.id_token);

      for (const field of PII_FIELDS) {
        expect(
          idTokenPayload[field],
          `id_token must not contain PII field '${field}'`
        ).toBeUndefined();
      }

      // Authentication claims MUST be present
      expect(idTokenPayload.sub).toBeTruthy();
      expect(idTokenPayload.iss).toBeTruthy();
      expect(idTokenPayload.aud).toBeTruthy();
      expect(idTokenPayload.iat).toBeTruthy();
      expect(idTokenPayload.exp).toBeTruthy();
    }

    // 9. Assert: access_token contains no release_handle
    const atPayload = decodeJwt(tokenBody.access_token);
    expect(atPayload.release_handle).toBeUndefined();

    // 10. Call userinfo → assert identity PII is returned
    const userinfoRes = await request.get(USERINFO_URL, {
      headers: { Authorization: `Bearer ${tokenBody.access_token}` },
    });
    expect(userinfoRes.ok()).toBeTruthy();
    const userinfo = (await userinfoRes.json()) as Record<string, unknown>;

    expect(userinfo.given_name).toBe("Ada");
    expect(userinfo.family_name).toBe("Lovelace");
    expect(userinfo.name).toBe("Ada Lovelace");
    expect(userinfo.birthdate).toBe("1815-12-10");
    expect(userinfo.sub).toBeTruthy();

    // 11. Second userinfo call returns 401 invalid_token — single-use binding
    // (exact disclosure enforcement: once PII has been delivered, the
    // release context is consumed and the token is no longer usable)
    const userinfo2Res = await request.get(USERINFO_URL, {
      headers: { Authorization: `Bearer ${tokenBody.access_token}` },
    });
    expect(userinfo2Res.status()).toBe(401);
    const userinfo2 = (await userinfo2Res.json()) as Record<string, unknown>;
    expect(userinfo2.error).toBe("invalid_token");
  });

  test("CIBA flow without identity scopes: userinfo returns no PII, id_token has no PII", async ({
    request,
  }) => {
    const session = await createIssuerSession(request);
    const clientId = await registerCibaClient(request);

    // CIBA with openid-only scope (no identity scopes)
    const bcRes = await request.post(`${AUTH_BASE_URL}/oauth2/bc-authorize`, {
      data: {
        client_id: clientId,
        login_hint: session.email,
        scope: "openid",
        binding_message: "Non-identity E2E test",
        resource: BASE_URL,
      },
      headers: ORIGIN_HEADERS,
    });
    expect(bcRes.ok()).toBeTruthy();
    const { auth_req_id } = (await bcRes.json()) as { auth_req_id: string };

    // Approve without staging PII
    const approveRes = await request.post(`${AUTH_BASE_URL}/ciba/authorize`, {
      data: { auth_req_id },
      headers: { Cookie: session.cookieHeader, ...ORIGIN_HEADERS },
    });
    expect(approveRes.ok()).toBeTruthy();

    // Poll for tokens
    const dpop = await createDpopProof({
      method: "POST",
      url: TOKEN_URL,
    });
    const tokenRes = await request.post(TOKEN_URL, {
      form: {
        grant_type: CIBA_GRANT_TYPE,
        auth_req_id,
        client_id: clientId,
        resource: BASE_URL,
      },
      headers: { Origin: BASE_URL, DPoP: dpop.proof },
    });
    if (!tokenRes.ok()) {
      throw new Error(
        `token exchange failed (${tokenRes.status()} ${tokenRes.statusText()}): ${await tokenRes.text()}`
      );
    }
    const tokenBody = (await tokenRes.json()) as {
      access_token: string;
      id_token?: string;
    };

    // id_token has zero PII
    if (tokenBody.id_token) {
      const idTokenPayload = decodeJwt(tokenBody.id_token);
      for (const field of PII_FIELDS) {
        expect(idTokenPayload[field]).toBeUndefined();
      }
    }

    // Userinfo has no PII
    const userinfoRes = await request.get(USERINFO_URL, {
      headers: { Authorization: `Bearer ${tokenBody.access_token}` },
    });
    expect(userinfoRes.ok()).toBeTruthy();
    const userinfo = (await userinfoRes.json()) as Record<string, unknown>;

    for (const field of PII_FIELDS) {
      expect(
        userinfo[field],
        `userinfo must not contain PII field '${field}' when no identity scopes granted`
      ).toBeUndefined();
    }
  });
});
