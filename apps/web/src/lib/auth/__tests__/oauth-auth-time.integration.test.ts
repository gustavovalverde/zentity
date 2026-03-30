import crypto from "node:crypto";

import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db/connection";
import { sessions, verifications } from "@/lib/db/schema/auth";
import {
  oauthClients,
  oauthRefreshTokens,
} from "@/lib/db/schema/oauth-provider";
import {
  createTestAuthContext,
  createTestUser,
  resetDatabase,
} from "@/test/db-test-utils";
import { postTokenWithDpop } from "@/test/dpop-test-utils";

const REDIRECT_URI = "http://127.0.0.1/callback";

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

describe("oauth token auth_time normalization", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("issues refresh tokens when session.createdAt is stored as millis text", async () => {
    const userId = await createTestUser({ emailVerified: true });
    const clientId = "installed-agent-client";
    const sessionId = "session-auth-time";
    const authorizationCode = "auth-code-auth-time";
    const now = Date.now();
    const createdAtMillisText = `${now - 60_000}.0`;
    const codeVerifier = "pkce-verifier-auth-time";
    const { challenge } = await createPkceChallenge(codeVerifier);
    const authContextId = await createTestAuthContext(userId);

    await db
      .insert(oauthClients)
      .values({
        clientId,
        name: "Installed Agent",
        public: true,
        disabled: false,
        scopes: JSON.stringify(["openid", "email", "offline_access"]),
        grantTypes: JSON.stringify(["authorization_code", "refresh_token"]),
        redirectUris: JSON.stringify([REDIRECT_URI]),
        responseTypes: JSON.stringify(["code"]),
        tokenEndpointAuthMethod: "none",
        createdAt: new Date(now),
      })
      .run();

    await db
      .insert(sessions)
      .values({
        id: sessionId,
        token: "session-token-auth-time",
        userId,
        authContextId,
        createdAt: createdAtMillisText,
        updatedAt: createdAtMillisText,
        expiresAt: `${now + 60 * 60 * 1000}.0`,
      })
      .run();

    await db
      .insert(verifications)
      .values({
        id: crypto.randomUUID(),
        identifier: await hashStoredAuthorizationCode(authorizationCode),
        value: JSON.stringify({
          type: "authorization_code",
          query: {
            client_id: clientId,
            response_type: "code",
            redirect_uri: REDIRECT_URI,
            scope: "openid email offline_access",
            code_challenge: challenge,
            code_challenge_method: "S256",
            resource: "http://localhost:3000",
          },
          userId,
          sessionId,
          authTime: null,
        }),
        createdAt: new Date(now).toISOString(),
        updatedAt: new Date(now).toISOString(),
        expiresAt: new Date(now + 5 * 60 * 1000).toISOString(),
      })
      .run();

    const { status, json } = await postTokenWithDpop({
      grant_type: "authorization_code",
      client_id: clientId,
      code: authorizationCode,
      code_verifier: codeVerifier,
      redirect_uri: REDIRECT_URI,
      resource: "http://localhost:3000",
    });

    expect(status).toBe(200);
    expect(json).toEqual(
      expect.objectContaining({
        access_token: expect.any(String),
        refresh_token: expect.any(String),
        token_type: "DPoP",
        scope: "openid email offline_access",
      })
    );

    const refreshTokenRecord = await db
      .select({
        authTime: oauthRefreshTokens.authTime,
        clientId: oauthRefreshTokens.clientId,
      })
      .from(oauthRefreshTokens)
      .where(eq(oauthRefreshTokens.clientId, clientId))
      .limit(1)
      .get();

    expect(refreshTokenRecord).toEqual(
      expect.objectContaining({
        clientId,
      })
    );
  });
});
