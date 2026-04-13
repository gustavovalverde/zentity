import crypto from "node:crypto";

import { beforeEach, describe, expect, it } from "vitest";

import { auth } from "@/lib/auth/auth-config";
import { createAuthenticationContext } from "@/lib/auth/auth-context";
import { stageFinalCibaDisclosure } from "@/lib/auth/oidc/disclosure/context";
import { createScopeHash } from "@/lib/auth/oidc/disclosure/delivery";
import { db } from "@/lib/db/connection";
import { cibaRequests } from "@/lib/db/schema/ciba";
import { oauthClients } from "@/lib/db/schema/oauth-provider";
import { createTestUser, resetDatabase } from "@/test-utils/db-test-utils";
import { postTokenWithDpop } from "@/test-utils/dpop-test-utils";

const CIBA_GRANT_TYPE = "urn:openid:params:grant-type:ciba";
const TEST_CLIENT_ID = "userinfo-disclosure-client";
const USERINFO_URL = "http://localhost:3000/api/auth/oauth2/userinfo";

function clearIdentityPayloadStore(): void {
  const store = (
    globalThis as Record<symbol, Map<string, unknown> | undefined>
  )[Symbol.for("zentity.ephemeral-identity-claims")];
  store?.clear();
}

async function createTestClient(clientId = TEST_CLIENT_ID) {
  await db
    .insert(oauthClients)
    .values({
      clientId,
      name: "UserInfo Disclosure Test Client",
      redirectUris: JSON.stringify(["http://localhost/callback"]),
      grantTypes: JSON.stringify([CIBA_GRANT_TYPE]),
      tokenEndpointAuthMethod: "none",
      public: true,
    })
    .run();
}

async function insertApprovedCibaRequest(
  userId: string,
  authContextId: string,
  scope = "openid identity.name"
) {
  const authReqId = crypto.randomUUID();
  await db
    .insert(cibaRequests)
    .values({
      authReqId,
      clientId: TEST_CLIENT_ID,
      userId,
      scope,
      status: "approved",
      authContextId,
      expiresAt: new Date(Date.now() + 300_000),
    })
    .run();
  return authReqId;
}

async function parseHandlerJson(
  response: Response
): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (!text) {
    return {};
  }

  const parsed = JSON.parse(text) as Record<string, unknown>;
  return parsed && typeof parsed === "object" && "response" in parsed
    ? (parsed.response as Record<string, unknown>)
    : parsed;
}

function makeUserInfoRequest(accessToken: string): Request {
  return new Request(USERINFO_URL, {
    method: "GET",
    headers: {
      authorization: `Bearer ${accessToken}`,
    },
  });
}

describe("userinfo disclosure binding", () => {
  let userId: string;
  let authContextId: string;

  beforeEach(async () => {
    await resetDatabase();
    clearIdentityPayloadStore();
    userId = await createTestUser();
    await createTestClient();
    authContextId = (
      await createAuthenticationContext({
        userId,
        loginMethod: "passkey",
        authenticatedAt: new Date(),
        sourceKind: "ciba_approval",
        referenceType: "ciba_request",
      })
    ).id;
  });

  it("delivers an exact bound identity payload once for opaque CIBA access tokens", async () => {
    const authReqId = await insertApprovedCibaRequest(userId, authContextId);
    const identityScopes = ["identity.name"];

    expect(
      await stageFinalCibaDisclosure({
        userId,
        clientId: TEST_CLIENT_ID,
        claims: {
          given_name: "Ada",
          family_name: "Lovelace",
        },
        releaseId: authReqId,
        scopes: identityScopes,
        scopeHash: createScopeHash(identityScopes),
        intentJti: crypto.randomUUID(),
      })
    ).toEqual({ ok: true });

    const tokenResponse = await postTokenWithDpop({
      grant_type: CIBA_GRANT_TYPE,
      auth_req_id: authReqId,
      client_id: TEST_CLIENT_ID,
    });

    expect(tokenResponse.status).toBe(200);
    expect(typeof tokenResponse.json.access_token).toBe("string");

    const accessToken = tokenResponse.json.access_token as string;
    expect(accessToken.split(".").length).not.toBe(3);

    const firstUserInfo = await auth.handler(makeUserInfoRequest(accessToken));
    expect(firstUserInfo.status).toBe(200);
    await expect(parseHandlerJson(firstUserInfo)).resolves.toMatchObject({
      sub: userId,
      given_name: "Ada",
      family_name: "Lovelace",
    });

    const secondUserInfo = await auth.handler(makeUserInfoRequest(accessToken));
    const secondBody = await parseHandlerJson(secondUserInfo);
    expect(secondUserInfo.status).toBe(401);
    expect(secondBody.error).toBe("invalid_token");
  });
});
