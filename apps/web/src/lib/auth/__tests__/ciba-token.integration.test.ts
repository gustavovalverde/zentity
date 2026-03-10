import crypto from "node:crypto";

import { decodeJwt } from "jose";
import { beforeEach, describe, expect, it } from "vitest";

import {
  resetEphemeralIdentityClaimsStore,
  storeEphemeralClaims,
} from "@/lib/auth/oidc/ephemeral-identity-claims";
import { createScopeHash } from "@/lib/auth/oidc/identity-intent";
import { db } from "@/lib/db/connection";
import { cibaRequests } from "@/lib/db/schema/ciba";
import { oauthClients } from "@/lib/db/schema/oauth-provider";
import { createTestUser, resetDatabase } from "@/test/db-test-utils";

import { auth } from "../auth";

const CIBA_GRANT_TYPE = "urn:openid:params:grant-type:ciba";
const TOKEN_URL = "http://localhost:3000/api/auth/oauth2/token";
const TEST_CLIENT_ID = "ciba-test-agent";
// Resource must match a validAudiences entry so the access token is JWT (not opaque)
const TEST_RESOURCE = "http://localhost:3000/api/auth";

async function createTestClient(clientId = TEST_CLIENT_ID) {
  await db
    .insert(oauthClients)
    .values({
      clientId,
      name: "CIBA Test Agent",
      redirectUris: ["http://localhost/callback"],
      grantTypes: [CIBA_GRANT_TYPE],
      tokenEndpointAuthMethod: "none",
      public: true,
    })
    .run();
}

async function insertCibaRequest(
  overrides: Partial<typeof cibaRequests.$inferInsert> = {}
) {
  const authReqId = overrides.authReqId ?? crypto.randomUUID();
  await db
    .insert(cibaRequests)
    .values({
      authReqId,
      clientId: TEST_CLIENT_ID,
      userId: overrides.userId ?? "test-user",
      scope: "openid",
      status: "pending",
      expiresAt: new Date(Date.now() + 300_000),
      ...overrides,
    })
    .run();
  return authReqId;
}

async function postToken(
  body: Record<string, string>
): Promise<{ status: number; json: Record<string, unknown> }> {
  const response = await auth.handler(
    new Request(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body),
    })
  );

  const text = await response.text();
  let json: Record<string, unknown> = {};
  if (text) {
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      // Unwrap better-auth's { response: ... } envelope
      json =
        parsed && typeof parsed === "object" && "response" in parsed
          ? (parsed.response as Record<string, unknown>)
          : parsed;
    } catch {
      json = { raw: text };
    }
  }

  return { status: response.status, json };
}

describe("CIBA token endpoint", () => {
  let userId: string;

  beforeEach(async () => {
    await resetDatabase();
    await resetEphemeralIdentityClaimsStore();
    userId = await createTestUser();
    await createTestClient();
  });

  it("returns authorization_pending for a pending request", async () => {
    const authReqId = await insertCibaRequest({ userId, status: "pending" });

    const { status, json } = await postToken({
      grant_type: CIBA_GRANT_TYPE,
      auth_req_id: authReqId,
      client_id: TEST_CLIENT_ID,
    });

    expect(status).toBe(400);
    expect(json.error).toBe("authorization_pending");
  });

  it("returns access_denied for a rejected request", async () => {
    const authReqId = await insertCibaRequest({ userId, status: "rejected" });

    const { status, json } = await postToken({
      grant_type: CIBA_GRANT_TYPE,
      auth_req_id: authReqId,
      client_id: TEST_CLIENT_ID,
    });

    expect(status).toBe(400);
    expect(json.error).toBe("access_denied");
  });

  it("returns expired_token for an expired request", async () => {
    const authReqId = await insertCibaRequest({
      userId,
      status: "pending",
      expiresAt: new Date(Date.now() - 1000),
    });

    const { status, json } = await postToken({
      grant_type: CIBA_GRANT_TYPE,
      auth_req_id: authReqId,
      client_id: TEST_CLIENT_ID,
    });

    expect(status).toBe(400);
    expect(json.error).toBe("expired_token");
  });

  it("returns tokens for an approved request", async () => {
    const authReqId = await insertCibaRequest({ userId, status: "approved" });

    const { status, json } = await postToken({
      grant_type: CIBA_GRANT_TYPE,
      auth_req_id: authReqId,
      client_id: TEST_CLIENT_ID,
    });

    expect(status).toBe(200);
    expect(json.access_token).toBeDefined();
    expect(typeof json.access_token).toBe("string");
    expect(json.token_type).toBeDefined();
    expect(json.expires_in).toBeDefined();
  });

  it("includes act claim in access token JWT", async () => {
    const authReqId = await insertCibaRequest({
      userId,
      status: "approved",
      resource: TEST_RESOURCE,
    });

    const { json } = await postToken({
      grant_type: CIBA_GRANT_TYPE,
      auth_req_id: authReqId,
      client_id: TEST_CLIENT_ID,
    });

    const payload = decodeJwt(json.access_token as string);
    expect(payload.act).toEqual({ sub: TEST_CLIENT_ID });
  });

  it("forwards authorization_details to token and response", async () => {
    const authorizationDetails = JSON.stringify([
      {
        type: "purchase",
        merchant: "Test Store",
        item: "Widget",
        amount: { currency: "USD", value: "9.99" },
      },
    ]);
    const authReqId = await insertCibaRequest({
      userId,
      status: "approved",
      resource: TEST_RESOURCE,
      authorizationDetails,
    });

    const { json } = await postToken({
      grant_type: CIBA_GRANT_TYPE,
      auth_req_id: authReqId,
      client_id: TEST_CLIENT_ID,
    });

    // authorization_details in token response body (RFC 9396 §7)
    expect(json.authorization_details).toEqual([
      {
        type: "purchase",
        merchant: "Test Store",
        item: "Widget",
        amount: { currency: "USD", value: "9.99" },
      },
    ]);

    // authorization_details embedded in access token JWT
    const payload = decodeJwt(json.access_token as string);
    expect(payload.authorization_details).toEqual([
      {
        type: "purchase",
        merchant: "Test Store",
        item: "Widget",
        amount: { currency: "USD", value: "9.99" },
      },
    ]);
  });

  it("omits authorization_details when CIBA request has none", async () => {
    const authReqId = await insertCibaRequest({ userId, status: "approved" });

    const { json } = await postToken({
      grant_type: CIBA_GRANT_TYPE,
      auth_req_id: authReqId,
      client_id: TEST_CLIENT_ID,
    });

    expect(json.authorization_details).toBeUndefined();
  });

  it("deletes CIBA request after successful token issuance (replay prevention)", async () => {
    const authReqId = await insertCibaRequest({ userId, status: "approved" });

    // First poll succeeds
    const { status } = await postToken({
      grant_type: CIBA_GRANT_TYPE,
      auth_req_id: authReqId,
      client_id: TEST_CLIENT_ID,
    });
    expect(status).toBe(200);

    // Second poll with same auth_req_id should fail
    const { status: replayStatus, json: replayJson } = await postToken({
      grant_type: CIBA_GRANT_TYPE,
      auth_req_id: authReqId,
      client_id: TEST_CLIENT_ID,
    });
    expect(replayStatus).toBe(400);
    expect(replayJson.error).toBe("invalid_grant");
  });

  it("returns slow_down when polled too frequently", async () => {
    const authReqId = await insertCibaRequest({
      userId,
      status: "pending",
      pollingInterval: 5,
      lastPolledAt: Date.now(),
    });

    const { status, json } = await postToken({
      grant_type: CIBA_GRANT_TYPE,
      auth_req_id: authReqId,
      client_id: TEST_CLIENT_ID,
    });

    expect(status).toBe(400);
    expect(json.error).toBe("slow_down");
  });

  it("rejects when client_id does not match CIBA request", async () => {
    await db
      .insert(oauthClients)
      .values({
        clientId: "other-agent",
        name: "Other Agent",
        redirectUris: ["http://localhost/callback"],
        grantTypes: [CIBA_GRANT_TYPE],
        tokenEndpointAuthMethod: "none",
        public: true,
      })
      .run();

    const authReqId = await insertCibaRequest({ userId, status: "approved" });

    const { status, json } = await postToken({
      grant_type: CIBA_GRANT_TYPE,
      auth_req_id: authReqId,
      client_id: "other-agent",
    });

    expect(status).toBe(400);
    expect(json.error).toBe("invalid_grant");
  });

  describe("identity claims via ephemeral staging", () => {
    it("includes PII claims in id_token when ephemeral claims are staged", async () => {
      const identityScopes = ["openid", "identity.name", "identity.dob"];
      const authReqId = await insertCibaRequest({
        userId,
        status: "approved",
        scope: identityScopes.join(" "),
      });

      // Stage PII in the ephemeral store (simulates vault unlock → stage endpoint)
      const scopeHash = createScopeHash(identityScopes);
      const stored = await storeEphemeralClaims(
        userId,
        {
          given_name: "Alice",
          family_name: "Smith",
          name: "Alice Smith",
          birthdate: "1990-01-15",
        },
        identityScopes,
        {
          clientId: TEST_CLIENT_ID,
          scopeHash,
          intentJti: crypto.randomUUID(),
        }
      );
      expect(stored.ok).toBe(true);

      const { status, json } = await postToken({
        grant_type: CIBA_GRANT_TYPE,
        auth_req_id: authReqId,
        client_id: TEST_CLIENT_ID,
      });

      expect(status).toBe(200);
      expect(json.id_token).toBeDefined();

      const idToken = decodeJwt(json.id_token as string);
      expect(idToken.given_name).toBe("Alice");
      expect(idToken.family_name).toBe("Smith");
      expect(idToken.name).toBe("Alice Smith");
      expect(idToken.birthdate).toBe("1990-01-15");
    });

    it("does not include PII when no ephemeral claims are staged", async () => {
      const authReqId = await insertCibaRequest({
        userId,
        status: "approved",
        scope: "openid",
      });

      const { status, json } = await postToken({
        grant_type: CIBA_GRANT_TYPE,
        auth_req_id: authReqId,
        client_id: TEST_CLIENT_ID,
      });

      expect(status).toBe(200);
      expect(json.id_token).toBeDefined();

      const idToken = decodeJwt(json.id_token as string);
      expect(idToken.given_name).toBeUndefined();
      expect(idToken.family_name).toBeUndefined();
      expect(idToken.birthdate).toBeUndefined();
    });

    it("ephemeral claims are consumed (single-use)", async () => {
      const identityScopes = ["openid", "identity.name"];
      const authReqId1 = await insertCibaRequest({
        userId,
        status: "approved",
        scope: identityScopes.join(" "),
      });

      const scopeHash = createScopeHash(identityScopes);
      await storeEphemeralClaims(
        userId,
        { given_name: "Bob", name: "Bob" },
        identityScopes,
        {
          clientId: TEST_CLIENT_ID,
          scopeHash,
          intentJti: crypto.randomUUID(),
        }
      );

      // First token request consumes the claims
      const { json: json1 } = await postToken({
        grant_type: CIBA_GRANT_TYPE,
        auth_req_id: authReqId1,
        client_id: TEST_CLIENT_ID,
      });
      const idToken1 = decodeJwt(json1.id_token as string);
      expect(idToken1.given_name).toBe("Bob");

      // Second request (new auth_req_id, same user) gets no PII
      const authReqId2 = await insertCibaRequest({
        userId,
        status: "approved",
        scope: identityScopes.join(" "),
      });
      const { json: json2 } = await postToken({
        grant_type: CIBA_GRANT_TYPE,
        auth_req_id: authReqId2,
        client_id: TEST_CLIENT_ID,
      });
      const idToken2 = decodeJwt(json2.id_token as string);
      expect(idToken2.given_name).toBeUndefined();
    });
  });
});
