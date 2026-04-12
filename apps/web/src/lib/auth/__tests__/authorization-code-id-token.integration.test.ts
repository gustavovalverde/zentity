import crypto from "node:crypto";

import { decodeJwt } from "jose";
import { beforeEach, describe, expect, it } from "vitest";

import {
  AUTHENTICATION_CONTEXT_CLAIM,
  createAuthenticationContext,
} from "@/lib/auth/authentication-context";
import {
  claimsRequestForEndpoint,
  loadReleaseContext,
} from "@/lib/auth/oidc/disclosure-context";
import { db } from "@/lib/db/connection";
import { sessions, verifications } from "@/lib/db/schema/auth";
import { oauthClients } from "@/lib/db/schema/oauth-provider";
import { createTestUser, resetDatabase } from "@/test-utils/db-test-utils";
import { postTokenWithDpop } from "@/test-utils/dpop-test-utils";

const REDIRECT_URI = "http://127.0.0.1/callback";
const TEST_CLIENT_ID = "oauth-id-token-filter-client";
const TEST_REFERENCE_ID = "oauth-reference-id-token-filter";

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

async function createTestClient() {
  await db
    .insert(oauthClients)
    .values({
      clientId: TEST_CLIENT_ID,
      name: "OAuth ID Token Filter Client",
      public: true,
      disabled: false,
      scopes: JSON.stringify(["openid"]),
      grantTypes: JSON.stringify(["authorization_code"]),
      redirectUris: JSON.stringify([REDIRECT_URI]),
      responseTypes: JSON.stringify(["code"]),
      tokenEndpointAuthMethod: "none",
      createdAt: new Date(),
    })
    .run();
}

describe("authorization_code id_token claims filtering", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("applies claims.id_token filters during a live authorization_code exchange", async () => {
    const userId = await createTestUser({ emailVerified: true });
    const codeVerifier = "pkce-verifier-id-token-filter";
    const authorizationCode = "auth-code-id-token-filter";
    const sessionId = "session-id-token-filter";
    const now = Date.now();
    const { challenge } = await createPkceChallenge(codeVerifier);

    await createTestClient();

    const authContext = await createAuthenticationContext({
      userId,
      loginMethod: "opaque",
      authenticatedAt: new Date(now - 60_000),
      sourceKind: "authorize_challenge_opaque",
      referenceType: "authorization_code",
      referenceId: TEST_REFERENCE_ID,
    });

    await db
      .insert(sessions)
      .values({
        id: sessionId,
        token: "session-token-id-token-filter",
        userId,
        authContextId: authContext.id,
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
          referenceId: TEST_REFERENCE_ID,
          query: {
            client_id: TEST_CLIENT_ID,
            response_type: "code",
            redirect_uri: REDIRECT_URI,
            scope: "openid",
            code_challenge: challenge,
            code_challenge_method: "S256",
            claims: JSON.stringify({
              id_token: {
                acr: null,
              },
            }),
          },
          userId,
          sessionId,
          authContextId: authContext.id,
          authTime: authContext.authenticatedAt * 1000,
        }),
        createdAt: new Date(now).toISOString(),
        updatedAt: new Date(now).toISOString(),
        expiresAt: new Date(now + 5 * 60 * 1000).toISOString(),
      })
      .run();

    const { status, json } = await postTokenWithDpop({
      grant_type: "authorization_code",
      client_id: TEST_CLIENT_ID,
      code: authorizationCode,
      code_verifier: codeVerifier,
      redirect_uri: REDIRECT_URI,
    });

    expect(status).toBe(200);
    expect(json.id_token).toEqual(expect.any(String));

    const releaseContext = await loadReleaseContext(TEST_REFERENCE_ID);
    expect(releaseContext).not.toBeNull();
    expect(
      claimsRequestForEndpoint(
        releaseContext?.claimsRequest ?? null,
        "id_token"
      )
    ).toEqual({
      acr: null,
    });

    const idTokenClaims = decodeJwt(json.id_token as string);
    expect(idTokenClaims.acr).toBe("urn:zentity:assurance:tier-0");
    expect(idTokenClaims[AUTHENTICATION_CONTEXT_CLAIM]).toBe(authContext.id);
    expect(idTokenClaims.amr).toBeUndefined();
    expect(idTokenClaims.acr_eidas).toBeUndefined();
  });
});
