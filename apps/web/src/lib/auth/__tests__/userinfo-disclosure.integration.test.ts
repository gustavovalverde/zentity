import crypto from "node:crypto";

import { decodeJwt } from "jose";
import { beforeEach, describe, expect, it } from "vitest";

import { auth } from "@/lib/auth/auth-config";
import { createAuthenticationContext } from "@/lib/auth/auth-context";
import {
  stageFinalCibaDisclosure,
  stagePendingOauthDisclosure,
} from "@/lib/auth/oidc/disclosure/context";
import { createScopeHash } from "@/lib/auth/oidc/disclosure/delivery";
import { computeOAuthRequestKey } from "@/lib/auth/oidc/oauth-request";
import { db } from "@/lib/db/connection";
import { sessions, verifications } from "@/lib/db/schema/auth";
import { cibaRequests } from "@/lib/db/schema/ciba";
import { oauthClients } from "@/lib/db/schema/oauth-provider";
import { createTestUser, resetDatabase } from "@/test-utils/db-test-utils";
import { postTokenWithDpop } from "@/test-utils/dpop-test-utils";

const CIBA_GRANT_TYPE = "urn:openid:params:grant-type:ciba";
const REDIRECT_URI = "http://127.0.0.1/callback";
const TEST_CLIENT_ID = "userinfo-disclosure-client";
const TEST_AUTH_CODE_CLIENT_ID = "userinfo-disclosure-auth-code-client";
const TEST_AUTH_CODE_REFERENCE_ID = "userinfo-disclosure-auth-code-reference";
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

async function createAuthCodeTestClient() {
  await db
    .insert(oauthClients)
    .values({
      clientId: TEST_AUTH_CODE_CLIENT_ID,
      name: "UserInfo Auth Code Disclosure Test Client",
      public: true,
      redirectUris: JSON.stringify([REDIRECT_URI]),
      grantTypes: JSON.stringify(["authorization_code"]),
      responseTypes: JSON.stringify(["code"]),
      tokenEndpointAuthMethod: "none",
      scopes: JSON.stringify(["openid", "identity.name"]),
      disabled: false,
      createdAt: new Date(),
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

async function createPkceChallenge(
  verifier: string
): Promise<{ challenge: string; verifier: string }> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier)
  );

  return {
    challenge: Buffer.from(digest).toString("base64url"),
    verifier,
  };
}

async function hashStoredAuthorizationCode(code: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(code)
  );

  return Buffer.from(digest).toString("base64url");
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

  it("delivers OAuth authorization-code identity payloads without public release claims", async () => {
    await createAuthCodeTestClient();
    const authorizationCode = "auth-code-userinfo-disclosure";
    const codeVerifier = "pkce-verifier-userinfo-disclosure";
    const sessionId = "session-userinfo-disclosure";
    const now = Date.now();
    const { challenge } = await createPkceChallenge(codeVerifier);
    const identityScopes = ["identity.name"];
    const oauthQuery = {
      client_id: TEST_AUTH_CODE_CLIENT_ID,
      response_type: "code",
      redirect_uri: REDIRECT_URI,
      scope: `openid ${identityScopes.join(" ")}`,
      code_challenge: challenge,
      code_challenge_method: "S256",
    };

    expect(
      await stagePendingOauthDisclosure({
        userId,
        clientId: TEST_AUTH_CODE_CLIENT_ID,
        claims: {
          given_name: "Grace",
          family_name: "Hopper",
        },
        scopes: identityScopes,
        scopeHash: createScopeHash(identityScopes),
        intentJti: crypto.randomUUID(),
        oauthRequestKey: computeOAuthRequestKey(oauthQuery),
      })
    ).toEqual({ ok: true });

    await db
      .insert(sessions)
      .values({
        id: sessionId,
        token: "session-token-userinfo-disclosure",
        userId,
        authContextId,
        createdAt: new Date(now - 60_000).toISOString(),
        updatedAt: new Date(now - 60_000).toISOString(),
        expiresAt: new Date(now + 60 * 60 * 1000).toISOString(),
      })
      .run();

    await db
      .insert(verifications)
      .values({
        id: crypto.randomUUID(),
        identifier: await hashStoredAuthorizationCode(authorizationCode),
        value: JSON.stringify({
          type: "authorization_code",
          referenceId: TEST_AUTH_CODE_REFERENCE_ID,
          query: oauthQuery,
          userId,
          sessionId,
          authContextId,
          authTime: now,
        }),
        createdAt: new Date(now).toISOString(),
        updatedAt: new Date(now).toISOString(),
        expiresAt: new Date(now + 5 * 60 * 1000).toISOString(),
      })
      .run();

    const tokenResponse = await postTokenWithDpop({
      grant_type: "authorization_code",
      client_id: TEST_AUTH_CODE_CLIENT_ID,
      code: authorizationCode,
      code_verifier: codeVerifier,
      redirect_uri: REDIRECT_URI,
    });

    expect(tokenResponse.status).toBe(200);
    expect(typeof tokenResponse.json.access_token).toBe("string");

    const accessToken = tokenResponse.json.access_token as string;
    if (accessToken.split(".").length === 3) {
      const payload = decodeJwt(accessToken);
      expect(payload).not.toHaveProperty("zentity_release_id");
      expect(payload).not.toHaveProperty("zentity_context_id");
    }

    const userInfo = await auth.handler(makeUserInfoRequest(accessToken));
    expect(userInfo.status).toBe(200);
    await expect(parseHandlerJson(userInfo)).resolves.toMatchObject({
      sub: userId,
      given_name: "Grace",
      family_name: "Hopper",
    });
  });
});
