import crypto from "node:crypto";

import { client, ready, server } from "@serenity-kit/opaque";
import { beforeEach, describe, expect, it } from "vitest";

import { env } from "@/env";
import { db } from "@/lib/db/connection";
import { accounts } from "@/lib/db/schema/auth";
import { oauthClients } from "@/lib/db/schema/oauth-provider";
import { createTestUser, resetDatabase } from "@/test/db-test-utils";
import { postTokenWithDpop } from "@/test/dpop-test-utils";

const CHALLENGE_URL = "http://localhost:3000/api/oauth2/authorize-challenge";
const TEST_CLIENT_ID = "fpa-test-client";
const TEST_PASSWORD = "correct-horse-battery-staple";
const TEST_EMAIL = "alice@example.com";

async function createTestClient() {
  await db
    .insert(oauthClients)
    .values({
      clientId: TEST_CLIENT_ID,
      name: "FPA Test Client",
      redirectUris: ["http://localhost/callback"],
      grantTypes: ["authorization_code"],
      tokenEndpointAuthMethod: "none",
      public: true,
    })
    .run();
}

async function createUserWithOpaque(
  email: string
): Promise<{ userId: string; registrationRecord: string }> {
  await ready;
  const userId = await createTestUser({ email });

  // Register OPAQUE credentials
  const { registrationRequest, clientRegistrationState } =
    client.startRegistration({ password: TEST_PASSWORD });

  const { registrationResponse } = server.createRegistrationResponse({
    serverSetup: env.OPAQUE_SERVER_SETUP,
    userIdentifier: userId,
    registrationRequest,
  });

  const { registrationRecord } = client.finishRegistration({
    clientRegistrationState,
    registrationResponse,
    password: TEST_PASSWORD,
  });

  await db
    .insert(accounts)
    .values({
      id: crypto.randomUUID(),
      accountId: userId,
      providerId: "opaque",
      userId,
      registrationRecord,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    .run();

  return { userId, registrationRecord };
}

function _post(body: Record<string, unknown>) {
  return fetch(CHALLENGE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// We don't run a real server, so call the route handler directly
async function callChallenge(
  body: Record<string, unknown>
): Promise<{ status: number; json: Record<string, unknown> }> {
  const { POST: handler } = await import(
    "@/app/api/oauth2/authorize-challenge/route"
  );
  const response = await handler(
    new Request(CHALLENGE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );
  const json = (await response.json()) as Record<string, unknown>;
  return { status: response.status, json };
}

// RFC 7636 example: code_verifier → code_challenge (S256)
const CODE_VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const CODE_CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

async function completeOpaqueFlow(): Promise<{
  authSession: string;
  authorizationCode: string;
}> {
  await ready;
  const round1 = await callChallenge({
    client_id: TEST_CLIENT_ID,
    response_type: "code",
    scope: "openid",
    code_challenge: CODE_CHALLENGE,
    code_challenge_method: "S256",
    identifier: TEST_EMAIL,
  });
  const authSession = round1.json.auth_session as string;

  const { clientLoginState, startLoginRequest } = client.startLogin({
    password: TEST_PASSWORD,
  });

  const round2 = await callChallenge({
    auth_session: authSession,
    opaque_login_request: startLoginRequest,
  });

  const loginResult = client.finishLogin({
    clientLoginState,
    loginResponse: round2.json.opaque_login_response as string,
    password: TEST_PASSWORD,
  });

  const round3 = await callChallenge({
    auth_session: authSession,
    opaque_finish_request: loginResult?.finishLoginRequest,
  });

  return {
    authSession,
    authorizationCode: round3.json.authorization_code as string,
  };
}

describe("Authorization Challenge Endpoint", () => {
  beforeEach(async () => {
    await resetDatabase();
    await createTestClient();
  });

  describe("Round 1: Initial request", () => {
    it("returns insufficient_authorization with OPAQUE challenge for user with password", async () => {
      await createUserWithOpaque(TEST_EMAIL);

      const { status, json } = await callChallenge({
        client_id: TEST_CLIENT_ID,
        response_type: "code",
        scope: "openid",
        code_challenge: CODE_CHALLENGE,
        code_challenge_method: "S256",
        identifier: TEST_EMAIL,
      });

      expect(status).toBe(401);
      expect(json.error).toBe("insufficient_authorization");
      expect(json.challenge_type).toBe("opaque");
      expect(json.auth_session).toBeTypeOf("string");
      expect(json.server_public_key).toBeTypeOf("string");
    });

    it("returns redirect_to_web for user without OPAQUE credentials", async () => {
      await createTestUser({ email: TEST_EMAIL });

      const { status, json } = await callChallenge({
        client_id: TEST_CLIENT_ID,
        response_type: "code",
        scope: "openid",
        code_challenge: CODE_CHALLENGE,
        code_challenge_method: "S256",
        identifier: TEST_EMAIL,
      });

      expect(status).toBe(400);
      expect(json.error).toBe("redirect_to_web");
      expect(json.auth_session).toBeTypeOf("string");
    });

    it("returns redirect_to_web for unknown user (timing-safe)", async () => {
      const { status, json } = await callChallenge({
        client_id: TEST_CLIENT_ID,
        response_type: "code",
        scope: "openid",
        code_challenge: CODE_CHALLENGE,
        code_challenge_method: "S256",
        identifier: "nonexistent@example.com",
      });

      expect(status).toBe(400);
      expect(json.error).toBe("redirect_to_web");
    });

    it("rejects unknown client_id", async () => {
      const { status, json } = await callChallenge({
        client_id: "unknown-client",
        response_type: "code",
        scope: "openid",
        code_challenge: CODE_CHALLENGE,
        code_challenge_method: "S256",
        identifier: TEST_EMAIL,
      });

      expect(status).toBe(400);
      expect(json.error).toBe("invalid_client");
    });
  });

  describe("Full 3-round OPAQUE flow", () => {
    it("completes OPAQUE challenge and returns authorization_code", async () => {
      await createUserWithOpaque(TEST_EMAIL);
      const { authorizationCode } = await completeOpaqueFlow();

      expect(authorizationCode).toBeTypeOf("string");
      expect(authorizationCode.length).toBe(32);
    });
  });

  describe("Token exchange", () => {
    it("exchanges authorization code for tokens with auth_session in response", async () => {
      await createUserWithOpaque(TEST_EMAIL);
      const { authSession, authorizationCode } = await completeOpaqueFlow();

      const { status, json } = await postTokenWithDpop({
        grant_type: "authorization_code",
        client_id: TEST_CLIENT_ID,
        code: authorizationCode,
        code_verifier: CODE_VERIFIER,
      });

      expect({ status, json }).toMatchObject({
        status: 200,
        json: {
          access_token: expect.any(String),
          token_type: "DPoP",
          auth_session: authSession,
        },
      });
    });

    it("rejects token exchange without code_verifier (PKCE required)", async () => {
      await createUserWithOpaque(TEST_EMAIL);
      const { authorizationCode } = await completeOpaqueFlow();

      const { status, json } = await postTokenWithDpop({
        grant_type: "authorization_code",
        client_id: TEST_CLIENT_ID,
        code: authorizationCode,
      });

      expect(status).toBeGreaterThanOrEqual(400);
      expect(json.error).toBeDefined();
    });
  });

  describe("Session validation", () => {
    it("rejects expired auth_session", async () => {
      const { status, json } = await callChallenge({
        auth_session: "nonexistent-session",
        opaque_login_request: "dGVzdA",
      });

      expect(status).toBe(400);
      expect(json.error).toBe("invalid_session");
    });

    it("rejects double-completion of auth_session", async () => {
      await ready;
      await createUserWithOpaque(TEST_EMAIL);

      // Complete a full flow
      const round1 = await callChallenge({
        client_id: TEST_CLIENT_ID,
        response_type: "code",
        scope: "openid",
        code_challenge: CODE_CHALLENGE,
        code_challenge_method: "S256",
        identifier: TEST_EMAIL,
      });
      const authSession = round1.json.auth_session as string;

      const { clientLoginState, startLoginRequest } = client.startLogin({
        password: TEST_PASSWORD,
      });

      const round2 = await callChallenge({
        auth_session: authSession,
        opaque_login_request: startLoginRequest,
      });

      const loginResult = client.finishLogin({
        clientLoginState,
        loginResponse: round2.json.opaque_login_response as string,
        password: TEST_PASSWORD,
      });

      // First completion succeeds
      const round3 = await callChallenge({
        auth_session: authSession,
        opaque_finish_request: loginResult?.finishLoginRequest,
      });
      expect(round3.status).toBe(200);

      // Second attempt fails (session is code_issued)
      const retry = await callChallenge({
        auth_session: authSession,
        opaque_finish_request: loginResult?.finishLoginRequest,
      });
      expect(retry.status).toBe(400);
      expect(retry.json.error).toBe("invalid_session");
    });
  });
});
