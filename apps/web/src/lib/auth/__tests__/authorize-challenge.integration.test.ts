import type { Eip712TypedData } from "@/lib/auth/plugins/eip712/types";

import crypto from "node:crypto";

import { client, ready, server } from "@serenity-kit/opaque";
import { privateKeyToAccount } from "viem/accounts";
import { beforeEach, describe, expect, it } from "vitest";

import { ipRequestLog } from "@/app/api/oauth2/authorize-challenge/route";
import { env } from "@/env";
import { db } from "@/lib/db/connection";
import { accounts, walletAddresses } from "@/lib/db/schema/auth";
import { oauthClients } from "@/lib/db/schema/oauth-provider";
import { createTestUser, resetDatabase } from "@/test/db-test-utils";
import {
  buildDpopProof,
  createTestDpopKeyPair,
  postTokenWithDpop,
} from "@/test/dpop-test-utils";

const CHALLENGE_URL = "http://localhost:3000/api/oauth2/authorize-challenge";
const TEST_CLIENT_ID = "fpa-test-client";
const THIRD_PARTY_CLIENT_ID = "third-party-client";
const TEST_PASSWORD = "correct-horse-battery-staple";
const TEST_EMAIL = "alice@example.com";
const TEST_WALLET_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const TEST_WALLET = privateKeyToAccount(TEST_WALLET_KEY);

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
      firstParty: true,
    })
    .run();
}

async function createThirdPartyClient() {
  await db
    .insert(oauthClients)
    .values({
      clientId: THIRD_PARTY_CLIENT_ID,
      name: "Third-Party Client",
      redirectUris: ["http://localhost/callback"],
      grantTypes: ["authorization_code"],
      tokenEndpointAuthMethod: "none",
      public: true,
      firstParty: false,
    })
    .run();
}

async function createUserWithWallet(
  address: string,
  chainId = 1
): Promise<string> {
  const email = `${address.slice(2, 10).toLowerCase()}@wallet.zentity.app`;
  const userId = await createTestUser({ email });

  await db
    .insert(accounts)
    .values({
      id: crypto.randomUUID(),
      accountId: userId,
      providerId: "eip712",
      userId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    .run();

  await db
    .insert(walletAddresses)
    .values({
      userId,
      address,
      chainId,
      isPrimary: true,
      createdAt: new Date().toISOString(),
    })
    .run();

  return userId;
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

async function callChallenge(
  body: Record<string, unknown>,
  headers?: Record<string, string>
): Promise<{ status: number; json: Record<string, unknown> }> {
  const { POST: handler } = await import(
    "@/app/api/oauth2/authorize-challenge/route"
  );
  const response = await handler(
    new Request(CHALLENGE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    })
  );
  const json = (await response.json()) as Record<string, unknown>;
  return { status: response.status, json };
}

// RFC 7636 example: code_verifier → code_challenge (S256)
const CODE_VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const CODE_CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
const PAR_URI_RE = /^urn:ietf:params:oauth:request_uri:.+/;

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
    ipRequestLog.clear();
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

    it("returns redirect_to_web with request_uri for passkey-only user", async () => {
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
      expect(json.request_uri).toBeTypeOf("string");
      expect(json.request_uri).toMatch(PAR_URI_RE);
    });

    it("returns redirect_to_web without request_uri when no code_challenge", async () => {
      await createTestUser({ email: TEST_EMAIL });

      const { status, json } = await callChallenge({
        client_id: TEST_CLIENT_ID,
        response_type: "code",
        scope: "openid",
        identifier: TEST_EMAIL,
      });

      expect(status).toBe(400);
      expect(json.error).toBe("redirect_to_web");
      expect(json.request_uri).toBeUndefined();
    });

    it("returns insufficient_authorization for unknown user (timing-safe)", async () => {
      const { status, json } = await callChallenge({
        client_id: TEST_CLIENT_ID,
        response_type: "code",
        scope: "openid",
        code_challenge: CODE_CHALLENGE,
        code_challenge_method: "S256",
        identifier: "nonexistent@example.com",
      });

      // Unknown users look identical to OPAQUE users — timing-safe
      expect(status).toBe(401);
      expect(json.error).toBe("insufficient_authorization");
      expect(json.challenge_type).toBe("opaque");
      expect(json.server_public_key).toBeTypeOf("string");
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

    it("rejects replay of already-exchanged authorization code", async () => {
      await createUserWithOpaque(TEST_EMAIL);
      const { authorizationCode } = await completeOpaqueFlow();

      // First exchange succeeds
      const first = await postTokenWithDpop({
        grant_type: "authorization_code",
        client_id: TEST_CLIENT_ID,
        code: authorizationCode,
        code_verifier: CODE_VERIFIER,
      });
      expect(first.status).toBe(200);

      // Replay with a fresh DPoP key should fail (code consumed)
      const replay = await postTokenWithDpop({
        grant_type: "authorization_code",
        client_id: TEST_CLIENT_ID,
        code: authorizationCode,
        code_verifier: CODE_VERIFIER,
      });
      expect(replay.status).toBeGreaterThanOrEqual(400);
      expect(replay.json.error).toBeDefined();
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

  describe("First-party enforcement", () => {
    it("returns redirect_to_web for non-first-party client regardless of credentials", async () => {
      await createThirdPartyClient();
      await createUserWithOpaque(TEST_EMAIL);

      const { status, json } = await callChallenge({
        client_id: THIRD_PARTY_CLIENT_ID,
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
  });

  describe("Rate limiting", () => {
    it("returns 429 after exceeding 10 requests per minute from same IP", async () => {
      const ip = "192.168.1.100";
      const headers = { "X-Forwarded-For": ip };

      // First 10 requests succeed (may return 400 for invalid body, but not 429)
      for (let i = 0; i < 10; i++) {
        const { status } = await callChallenge(
          {
            client_id: TEST_CLIENT_ID,
            response_type: "code",
            scope: "openid",
            identifier: TEST_EMAIL,
          },
          headers
        );
        expect(status).not.toBe(429);
      }

      // 11th request should be rate-limited
      const { status, json } = await callChallenge(
        {
          client_id: TEST_CLIENT_ID,
          response_type: "code",
          scope: "openid",
          identifier: TEST_EMAIL,
        },
        headers
      );
      expect(status).toBe(429);
      expect(json.error).toBe("too_many_requests");
    });

    it("rate limits are per-IP (different IPs are independent)", async () => {
      // Exhaust rate limit for IP A
      for (let i = 0; i < 11; i++) {
        await callChallenge(
          {
            client_id: TEST_CLIENT_ID,
            response_type: "code",
            scope: "openid",
            identifier: TEST_EMAIL,
          },
          { "X-Forwarded-For": "10.0.0.1" }
        );
      }

      // IP B should still work
      const { status } = await callChallenge(
        {
          client_id: TEST_CLIENT_ID,
          response_type: "code",
          scope: "openid",
          identifier: TEST_EMAIL,
        },
        { "X-Forwarded-For": "10.0.0.2" }
      );
      expect(status).not.toBe(429);
    });
  });

  describe("DPoP key binding", () => {
    it("rejects DPoP key switch between round 1 and round 2", async () => {
      await createUserWithOpaque(TEST_EMAIL);

      const keyPair1 = await createTestDpopKeyPair();
      const dpopProof1 = await buildDpopProof(keyPair1, "POST", CHALLENGE_URL);

      const round1 = await callChallenge(
        {
          client_id: TEST_CLIENT_ID,
          response_type: "code",
          scope: "openid",
          code_challenge: CODE_CHALLENGE,
          code_challenge_method: "S256",
          identifier: TEST_EMAIL,
        },
        { DPoP: dpopProof1 }
      );
      expect(round1.status).toBe(401);
      const authSession = round1.json.auth_session as string;

      // Round 2 with a DIFFERENT DPoP key
      const keyPair2 = await createTestDpopKeyPair();
      const dpopProof2 = await buildDpopProof(keyPair2, "POST", CHALLENGE_URL);

      const { startLoginRequest } = client.startLogin({
        password: TEST_PASSWORD,
      });

      const round2 = await callChallenge(
        { auth_session: authSession, opaque_login_request: startLoginRequest },
        { DPoP: dpopProof2 }
      );
      expect(round2.status).toBe(400);
      expect(round2.json.error).toBe("invalid_session");
      expect(round2.json.error_description).toBe("DPoP key mismatch");
    });
  });

  describe("EIP-712 wallet challenge flow", () => {
    it("returns eip712 challenge type for wallet user (by email)", async () => {
      await createUserWithWallet(TEST_WALLET.address);

      const { status, json } = await callChallenge({
        client_id: TEST_CLIENT_ID,
        response_type: "code",
        scope: "openid",
        identifier: `${TEST_WALLET.address.slice(2, 10).toLowerCase()}@wallet.zentity.app`,
      });

      expect(status).toBe(401);
      expect(json.error).toBe("insufficient_authorization");
      expect(json.challenge_type).toBe("eip712");
      expect(json.auth_session).toBeTypeOf("string");
      expect(json.nonce).toBeTypeOf("string");
      expect(json.typed_data).toBeDefined();
    });

    it("returns eip712 challenge type for wallet user (by address)", async () => {
      await createUserWithWallet(TEST_WALLET.address);

      const { status, json } = await callChallenge({
        client_id: TEST_CLIENT_ID,
        response_type: "code",
        scope: "openid",
        identifier: TEST_WALLET.address,
      });

      expect(status).toBe(401);
      expect(json.challenge_type).toBe("eip712");
      expect(json.nonce).toBeTypeOf("string");
      expect(json.typed_data).toBeDefined();
    });

    it("completes 2-round EIP-712 flow and returns authorization_code", async () => {
      await createUserWithWallet(TEST_WALLET.address);

      const round1 = await callChallenge({
        client_id: TEST_CLIENT_ID,
        response_type: "code",
        scope: "openid",
        code_challenge: CODE_CHALLENGE,
        code_challenge_method: "S256",
        identifier: TEST_WALLET.address,
      });
      expect(round1.status).toBe(401);
      const authSession = round1.json.auth_session as string;
      const typedData = round1.json.typed_data as Eip712TypedData;

      const signature = await TEST_WALLET.signTypedData({
        domain: typedData.domain,
        types: typedData.types,
        primaryType: typedData.primaryType as "WalletAuth",
        message: typedData.message as { address: `0x${string}`; nonce: string },
      });

      const round2 = await callChallenge({
        auth_session: authSession,
        eip712_signature: signature,
      });
      expect(round2.status).toBe(200);
      expect(round2.json.authorization_code).toBeTypeOf("string");
      expect((round2.json.authorization_code as string).length).toBe(32);
    });

    it("exchanges EIP-712 authorization code for tokens", async () => {
      await createUserWithWallet(TEST_WALLET.address);

      const round1 = await callChallenge({
        client_id: TEST_CLIENT_ID,
        response_type: "code",
        scope: "openid",
        code_challenge: CODE_CHALLENGE,
        code_challenge_method: "S256",
        identifier: TEST_WALLET.address,
      });
      const authSession = round1.json.auth_session as string;
      const typedData = round1.json.typed_data as Eip712TypedData;

      const signature = await TEST_WALLET.signTypedData({
        domain: typedData.domain,
        types: typedData.types,
        primaryType: typedData.primaryType as "WalletAuth",
        message: typedData.message as { address: `0x${string}`; nonce: string },
      });

      const round2 = await callChallenge({
        auth_session: authSession,
        eip712_signature: signature,
      });
      const authorizationCode = round2.json.authorization_code as string;

      const { status, json } = await postTokenWithDpop({
        grant_type: "authorization_code",
        client_id: TEST_CLIENT_ID,
        code: authorizationCode,
        code_verifier: CODE_VERIFIER,
      });

      expect(status).toBe(200);
      expect(json.access_token).toBeTypeOf("string");
      expect(json.auth_session).toBe(authSession);
    });

    it("rejects invalid EIP-712 signature", async () => {
      await createUserWithWallet(TEST_WALLET.address);

      const round1 = await callChallenge({
        client_id: TEST_CLIENT_ID,
        response_type: "code",
        scope: "openid",
        identifier: TEST_WALLET.address,
      });

      const round2 = await callChallenge({
        auth_session: round1.json.auth_session as string,
        eip712_signature:
          "0x0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
      });
      expect(round2.status).toBe(401);
      expect(round2.json.error).toBe("access_denied");
    });
  });
});
