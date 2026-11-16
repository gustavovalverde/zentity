import crypto from "node:crypto";

import { client, ready, server } from "@serenity-kit/opaque";
import { eq } from "drizzle-orm";
import { decodeJwt } from "jose";
import { privateKeyToAccount } from "viem/accounts";
import { parseSiweMessage } from "viem/siwe";
import { beforeEach, describe, expect, it } from "vitest";

import { env } from "@/env";
import { auth } from "@/lib/auth/auth-config";
import { db } from "@/lib/db/connection";
import {
  accounts,
  authenticationContexts,
  sessions,
  users,
  verifications,
  walletAddresses,
} from "@/lib/db/schema/auth";
import { cibaRequests } from "@/lib/db/schema/ciba";
import { identityBundles } from "@/lib/db/schema/identity";
import {
  firstPartyAuthSessions,
  firstPartyFailureBudgets,
  oauthClients,
} from "@/lib/db/schema/oauth-provider";
import {
  createTestCibaRequest,
  createTestUser,
  resetDatabase,
} from "@/test-utils/db-test-utils";
import {
  buildDpopProof,
  createTestDpopKeyPair,
  type DpopKeyPair,
  postTokenWithDpop,
} from "@/test-utils/dpop-test-utils";

const CHALLENGE_URL =
  "http://localhost:3000/api/auth/oauth2/authorize-challenge";
const TOKEN_URL = "http://localhost:3000/api/auth/oauth2/token";
const TEST_CLIENT_ID = "fpa-test-client";
const TEST_PASSWORD = "correct-horse-battery-staple";
const TEST_EMAIL = "alice@example.com";
const TEST_WALLET = privateKeyToAccount(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
);
const UNKNOWN_WALLET = privateKeyToAccount(
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"
);
const TIER_1 = "urn:zentity:assurance:tier-1";
// RFC 7636 example: code_verifier → code_challenge (S256)
const CODE_VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const CODE_CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

type Json = Record<string, unknown>;

async function createClient(
  clientId: string,
  overrides: Partial<typeof oauthClients.$inferInsert> = {}
) {
  await db
    .insert(oauthClients)
    .values({
      clientId,
      name: clientId,
      redirectUris: JSON.stringify(["http://localhost/callback"]),
      grantTypes: JSON.stringify(["authorization_code"]),
      tokenEndpointAuthMethod: "none",
      firstParty: true,
      skipConsent: true,
      ...overrides,
    })
    .run();
}

async function createUserWithOpaque(email: string): Promise<string> {
  await ready;
  const userId = await createTestUser({ email });
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
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .run();
  return userId;
}

async function addWallet(userId: string, address: string, chainId = 1) {
  await db
    .insert(accounts)
    .values({
      id: crypto.randomUUID(),
      accountId: userId,
      providerId: "eip712",
      userId,
      createdAt: new Date(),
      updatedAt: new Date(),
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
}

async function createWalletUser(address: string): Promise<string> {
  const userId = await createTestUser({
    email: `${address.slice(2, 10).toLowerCase()}@wallet.zentity.app`,
  });
  await addWallet(userId, address);
  return userId;
}

/**
 * Posts to the challenge endpoint with a proof from `key`, form-encoded
 * unless `json` is set. `key: null` sends no DPoP header.
 */
async function challenge(
  key: DpopKeyPair | null,
  body: Record<string, string>,
  options: { json?: boolean; proof?: string } = {}
): Promise<{ headers: Headers; json: Json; status: number }> {
  const headers: Record<string, string> = {
    "Content-Type": options.json
      ? "application/json"
      : "application/x-www-form-urlencoded",
  };
  const proof =
    options.proof ??
    (key ? await buildDpopProof(key, "POST", CHALLENGE_URL) : undefined);
  if (proof) {
    headers.DPoP = proof;
  }
  const response = await auth.handler(
    new Request(CHALLENGE_URL, {
      method: "POST",
      headers,
      body: options.json
        ? JSON.stringify(body)
        : new URLSearchParams(body).toString(),
    })
  );
  return {
    headers: response.headers,
    json: (await response.json()) as Json,
    status: response.status,
  };
}

function initialRequest(overrides: Record<string, string> = {}) {
  return {
    client_id: TEST_CLIENT_ID,
    response_type: "code",
    scope: "openid",
    code_challenge: CODE_CHALLENGE,
    code_challenge_method: "S256",
    login_hint: TEST_EMAIL,
    ...overrides,
  };
}

/** Rounds 2 and 3 of an OPAQUE sign-in on an `auth_session`. */
async function answerOpaque(
  key: DpopKeyPair,
  authSession: string,
  extra: Record<string, string> = {}
) {
  await ready;
  const { clientLoginState, startLoginRequest } = client.startLogin({
    password: TEST_PASSWORD,
  });
  const round2 = await challenge(
    key,
    {
      ...extra,
      auth_session: authSession,
      opaque_login_request: startLoginRequest,
    },
    { json: true }
  );
  if (
    !(
      round2.status === 403 &&
      round2.json.challenge_type === "opaque" &&
      typeof round2.json.opaque_login_response === "string"
    )
  ) {
    throw new Error(`OPAQUE round 2 failed: ${JSON.stringify(round2.json)}`);
  }
  const login = client.finishLogin({
    clientLoginState,
    loginResponse: round2.json.opaque_login_response as string,
    password: TEST_PASSWORD,
  });
  if (!login) {
    throw new Error("OPAQUE login did not finish");
  }
  return challenge(
    key,
    {
      ...extra,
      auth_session: authSession,
      opaque_finish_request: login.finishLoginRequest,
    },
    { json: true }
  );
}

async function signInWithOpaque(
  key: DpopKeyPair,
  overrides: Record<string, string> = {}
) {
  const round1 = await challenge(key, initialRequest(overrides));
  const authSession = round1.json.auth_session;
  if (typeof authSession !== "string") {
    throw new Error(`OPAQUE round 1 failed: ${JSON.stringify(round1.json)}`);
  }
  return { authSession, round3: await answerOpaque(key, authSession) };
}

/** Signs a Sign-In with Ethereum challenge's message with EIP-191. */
function signChallenge(
  account: typeof TEST_WALLET,
  challengeBody: Json
): Promise<string> {
  return account.signMessage({ message: challengeBody.message as string });
}

function redeem(
  key: DpopKeyPair,
  code: string,
  clientAuth: Record<string, string> = { client_id: TEST_CLIENT_ID }
) {
  return postTokenWithDpop(
    {
      ...clientAuth,
      grant_type: "authorization_code",
      code,
      code_verifier: CODE_VERIFIER,
    },
    key
  );
}

async function seedTier1(userId: string) {
  await db
    .insert(identityBundles)
    .values({
      userId,
      fheKeyId: "test-fhe-key",
      fheStatus: "complete",
      validityStatus: "verified",
    })
    .run();
}

function countRows() {
  return db.select().from(firstPartyAuthSessions).all();
}

describe("Authorization Challenge Endpoint", () => {
  let key: DpopKeyPair;

  beforeEach(async () => {
    await resetDatabase();
    await createClient(TEST_CLIENT_ID);
    key = await createTestDpopKeyPair();
  });

  describe("initial request", () => {
    it("answers an OPAQUE user's email with an OPAQUE challenge", async () => {
      await createUserWithOpaque(TEST_EMAIL);

      const { headers, json, status } = await challenge(key, initialRequest());

      expect(status).toBe(403);
      expect(headers.get("cache-control")).toContain("no-store");
      expect(json).toMatchObject({
        error: "insufficient_authorization",
        challenge_type: "opaque",
        auth_session: expect.any(String),
        server_public_key: expect.any(String),
      });
    });

    it("gives an unknown email the same OPAQUE challenge", async () => {
      const { json, status } = await challenge(
        key,
        initialRequest({ login_hint: "nobody@example.com" })
      );

      expect(status).toBe(403);
      expect(Object.keys(json).sort()).toEqual(
        ["auth_session", "challenge_type", "error", "server_public_key"].sort()
      );
      expect(json.challenge_type).toBe("opaque");
    });

    it("sends a passkey-only user to the browser and keeps no auth_session", async () => {
      await createTestUser({ email: TEST_EMAIL });

      const { json, status } = await challenge(key, initialRequest());

      expect(status).toBe(403);
      expect(json.error).toBe("redirect_to_web");
      expect(json.auth_session).toBeUndefined();
      expect(await countRows()).toHaveLength(0);
    });

    it("never reveals a wallet-only user's address for an email hint", async () => {
      await createWalletUser(TEST_WALLET.address);
      const email = `${TEST_WALLET.address.slice(2, 10).toLowerCase()}@wallet.zentity.app`;

      const { json, status } = await challenge(
        key,
        initialRequest({ login_hint: email })
      );

      expect(status).toBe(403);
      expect(json.error).toBe("redirect_to_web");
      expect(JSON.stringify(json).toLowerCase()).not.toContain(
        TEST_WALLET.address.slice(2).toLowerCase()
      );
    });

    it("answers a wallet address with Sign-In with Ethereum even when the user has a password", async () => {
      const userId = await createUserWithOpaque(TEST_EMAIL);
      await addWallet(userId, TEST_WALLET.address);

      const { json, status } = await challenge(
        key,
        initialRequest({ login_hint: TEST_WALLET.address })
      );

      expect(status).toBe(403);
      expect(json).toMatchObject({
        challenge_type: "siwe",
        message: expect.any(String),
      });
      expect(json).not.toHaveProperty("typed_data");
    });

    it("gives an unknown address the same Sign-In with Ethereum challenge as a registered one", async () => {
      const userId = await createTestUser({ email: TEST_EMAIL });
      await addWallet(userId, TEST_WALLET.address, 137);

      const known = await challenge(
        key,
        initialRequest({ login_hint: TEST_WALLET.address })
      );
      const unknown = await challenge(
        key,
        initialRequest({ login_hint: UNKNOWN_WALLET.address })
      );

      expect(unknown.status).toBe(known.status);
      expect(Object.keys(unknown.json).sort()).toEqual(
        Object.keys(known.json).sort()
      );
      expect(unknown.json.challenge_type).toBe("siwe");
      const knownMessage = parseSiweMessage(known.json.message as string);
      const unknownMessage = parseSiweMessage(unknown.json.message as string);
      expect(unknownMessage).toMatchObject({
        chainId: knownMessage.chainId,
        domain: knownMessage.domain,
        statement: knownMessage.statement,
        uri: knownMessage.uri,
      });
      expect(knownMessage.chainId).toBe(1);
    });

    it("reads a form-encoded chain_id as a number", async () => {
      await createWalletUser(TEST_WALLET.address);

      const { json } = await challenge(
        key,
        initialRequest({ login_hint: TEST_WALLET.address, chain_id: "5" })
      );

      expect(parseSiweMessage(json.message as string).chainId).toBe(5);
    });

    it("requires form encoding", async () => {
      await createUserWithOpaque(TEST_EMAIL);

      const { json, status } = await challenge(key, initialRequest(), {
        json: true,
      });

      expect(status).toBe(400);
      expect(json.error).toBe("invalid_request");
    });

    it("requires a DPoP proof", async () => {
      await createUserWithOpaque(TEST_EMAIL);

      const { json, status } = await challenge(null, initialRequest());

      expect(status).toBe(400);
      expect(json.error).toBe("invalid_dpop_proof");
      expect(await countRows()).toHaveLength(0);
    });

    it("refuses a redirect_uri, because challenge codes are headless", async () => {
      const { json, status } = await challenge(
        key,
        initialRequest({ redirect_uri: "http://localhost/callback" })
      );

      expect(status).toBe(400);
      expect(json.error).toBe("invalid_request");
    });

    it("refuses an unknown client", async () => {
      const { json, status } = await challenge(
        key,
        initialRequest({ client_id: "unknown-client" })
      );

      expect(status).toBe(400);
      expect(json.error).toBe("invalid_client");
    });

    it("refuses a confidential client that sends no credentials", async () => {
      await createClient("fpa-confidential", {
        clientSecret: crypto
          .createHash("sha256")
          .update("secret")
          .digest("base64url"),
        tokenEndpointAuthMethod: "client_secret_post",
      });

      const { json, status } = await challenge(
        key,
        initialRequest({ client_id: "fpa-confidential" })
      );

      expect(status).toBe(400);
      expect(json.error).toBe("invalid_client");
    });

    it.each([
      ["not first-party", { firstParty: false }],
      ["first-party without skip_consent", { skipConsent: false }],
    ])(
      "refuses a client that is %s with unauthorized_client",
      async (_, overrides) => {
        await createClient("other-client", overrides);
        await createUserWithOpaque(TEST_EMAIL);

        const { json, status } = await challenge(
          key,
          initialRequest({ client_id: "other-client" })
        );

        expect(status).toBe(400);
        expect(json.error).toBe("unauthorized_client");
        expect(await countRows()).toHaveLength(0);
      }
    );
  });

  describe("OPAQUE sign-in", () => {
    it("issues a DPoP-bound code in three rounds and rotates the auth_session at the token endpoint", async () => {
      const userId = await createUserWithOpaque(TEST_EMAIL);

      const { authSession, round3 } = await signInWithOpaque(key, {
        claims: JSON.stringify({ id_token: { acr: null } }),
      });
      expect(round3.status).toBe(200);
      const code = round3.json.authorization_code as string;
      expect(code).toEqual(expect.any(String));

      const token = await redeem(key, code);
      expect(token.status).toBe(200);
      expect(token.json.token_type).toBe("DPoP");
      expect(token.json.auth_session).toEqual(expect.any(String));
      expect(token.json.auth_session).not.toBe(authSession);

      const claims = decodeJwt(token.json.id_token as string);
      expect(claims.acr).toBe("urn:zentity:assurance:tier-0");
      expect(claims.amr).toEqual(["pwd"]);

      const contexts = await db
        .select({ sourceKind: authenticationContexts.sourceKind })
        .from(authenticationContexts)
        .where(eq(authenticationContexts.userId, userId))
        .all();
      expect(contexts).toEqual([{ sourceKind: "authorize_challenge_opaque" }]);
    });

    // A first-party client signs the user in without a consent screen, so it
    // may be granted only the scopes it registered.
    it("refuses a scope the client did not register before it starts a challenge", async () => {
      await db
        .update(oauthClients)
        .set({ scopes: JSON.stringify(["openid"]) })
        .where(eq(oauthClients.clientId, TEST_CLIENT_ID))
        .run();
      await createUserWithOpaque(TEST_EMAIL);

      const { json, status } = await challenge(
        key,
        initialRequest({ scope: "openid agent:host.register" })
      );

      expect(status).toBe(400);
      expect(json).toMatchObject({
        error: "invalid_scope",
        error_description: "client does not allow scope agent:host.register",
      });
      expect(await countRows()).toHaveLength(0);
    });

    it("grants agent bootstrap scopes the client registered", async () => {
      await db
        .update(oauthClients)
        .set({ scopes: JSON.stringify(["openid", "agent:host.register"]) })
        .where(eq(oauthClients.clientId, TEST_CLIENT_ID))
        .run();
      await createUserWithOpaque(TEST_EMAIL);

      const { round3 } = await signInWithOpaque(key, {
        scope: "openid agent:host.register",
      });
      const token = await redeem(key, round3.json.authorization_code as string);

      expect(token.status).toBe(200);
      expect(token.json.scope).toBe("openid agent:host.register");
    });

    it("refuses a redemption without a proof or with another key", async () => {
      await createUserWithOpaque(TEST_EMAIL);
      const { round3 } = await signInWithOpaque(key);
      const body = new URLSearchParams({
        grant_type: "authorization_code",
        client_id: TEST_CLIENT_ID,
        code: round3.json.authorization_code as string,
        code_verifier: CODE_VERIFIER,
      });

      const withoutProof = await auth.handler(
        new Request(TOKEN_URL, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body,
        })
      );
      expect(withoutProof.status).toBe(400);
      expect(await withoutProof.json()).toMatchObject({
        error: "invalid_dpop_proof",
      });

      const otherKey = await redeem(
        await createTestDpopKeyPair(),
        round3.json.authorization_code as string
      );
      expect(otherKey.status).toBe(400);
      expect(otherKey.json.error).toBe("invalid_dpop_proof");
    });

    it("requires the auth_session's key on every round", async () => {
      await createUserWithOpaque(TEST_EMAIL);
      const round1 = await challenge(key, initialRequest());
      const authSession = round1.json.auth_session as string;
      const { startLoginRequest } = client.startLogin({
        password: TEST_PASSWORD,
      });
      const request = {
        auth_session: authSession,
        opaque_login_request: startLoginRequest,
      };

      const otherKey = await challenge(await createTestDpopKeyPair(), request, {
        json: true,
      });
      expect(otherKey.status).toBe(400);
      expect(otherKey.json.error).toBe("invalid_dpop_proof");

      const noProof = await challenge(null, request, { json: true });
      expect(noProof.status).toBe(400);
      expect(noProof.json.error).toBe("invalid_dpop_proof");

      // The refused rounds changed nothing, so the bound key still continues.
      const bound = await challenge(key, request, { json: true });
      expect(bound.status).toBe(403);
      expect(bound.json.opaque_login_response).toEqual(expect.any(String));
    });

    it("refuses a replayed proof on the next round", async () => {
      await createUserWithOpaque(TEST_EMAIL);
      const proof = await buildDpopProof(key, "POST", CHALLENGE_URL);
      const round1 = await challenge(key, initialRequest(), { proof });
      const { startLoginRequest } = client.startLogin({
        password: TEST_PASSWORD,
      });

      const round2 = await challenge(
        key,
        {
          auth_session: round1.json.auth_session as string,
          opaque_login_request: startLoginRequest,
        },
        { json: true, proof }
      );

      expect(round2.status).toBe(400);
      expect(round2.json.error).toBe("invalid_dpop_proof");
    });

    it("refuses a DPoP header whose signature does not verify", async () => {
      await createUserWithOpaque(TEST_EMAIL);
      const victim = await createTestDpopKeyPair();
      const [, payload, signature] = (
        await buildDpopProof(key, "POST", CHALLENGE_URL)
      ).split(".");
      const header = Buffer.from(
        JSON.stringify({ alg: "ES256", typ: "dpop+jwt", jwk: victim.jwk })
      ).toString("base64url");

      const { json, status } = await challenge(key, initialRequest(), {
        proof: `${header}.${payload}.${signature}`,
      });

      expect(status).toBe(400);
      expect(json.error).toBe("invalid_dpop_proof");
      expect(json.auth_session).toBeUndefined();
    });

    it("answers a wrong credential with authentication_failed and ends the auth_session at the third", async () => {
      await createUserWithOpaque(TEST_EMAIL);
      const round1 = await challenge(key, initialRequest());
      const authSession = round1.json.auth_session as string;

      for (const attempt of [1, 2, 3]) {
        const { startLoginRequest } = client.startLogin({
          password: TEST_PASSWORD,
        });
        await challenge(
          key,
          {
            auth_session: authSession,
            opaque_login_request: startLoginRequest,
          },
          { json: true }
        );
        const finish = await challenge(
          key,
          {
            auth_session: authSession,
            opaque_finish_request: crypto.randomBytes(64).toString("base64url"),
          },
          { json: true }
        );
        if (attempt < 3) {
          expect(finish).toMatchObject({
            status: 400,
            json: {
              error: "authentication_failed",
              auth_session: authSession,
              challenge_type: "opaque",
              server_public_key: expect.any(String),
            },
          });
        } else {
          expect(finish.status).toBe(403);
          expect(finish.json.error).toBe("redirect_to_web");
          expect(finish.json.auth_session).toBeUndefined();
        }
      }

      const ended = await challenge(
        key,
        { auth_session: authSession },
        {
          json: true,
        }
      );
      expect(ended.status).toBe(400);
      expect(ended.json.error).toBe("invalid_session");
    });

    it("issues no second code for a replayed final round", async () => {
      await createUserWithOpaque(TEST_EMAIL);
      await ready;
      const round1 = await challenge(key, initialRequest());
      const authSession = round1.json.auth_session as string;
      const { clientLoginState, startLoginRequest } = client.startLogin({
        password: TEST_PASSWORD,
      });
      const round2 = await challenge(
        key,
        { auth_session: authSession, opaque_login_request: startLoginRequest },
        { json: true }
      );
      const login = client.finishLogin({
        clientLoginState,
        loginResponse: round2.json.opaque_login_response as string,
        password: TEST_PASSWORD,
      });
      const finish = {
        auth_session: authSession,
        opaque_finish_request: login?.finishLoginRequest ?? "",
      };

      expect((await challenge(key, finish, { json: true })).status).toBe(200);
      const replay = await challenge(key, finish, { json: true });

      expect(replay.status).toBe(400);
      expect(replay.json.authorization_code).toBeUndefined();
    });

    it("sends a user with two-factor enabled to the browser after the password", async () => {
      const userId = await createUserWithOpaque(TEST_EMAIL);
      await db
        .update(users)
        .set({ twoFactorEnabled: true })
        .where(eq(users.id, userId))
        .run();

      const { round3 } = await signInWithOpaque(key);

      expect(round3.status).toBe(403);
      expect(round3.json.error).toBe("redirect_to_web");
      expect(round3.json.authorization_code).toBeUndefined();
      expect(
        await db
          .select()
          .from(sessions)
          .where(eq(sessions.userId, userId))
          .all()
      ).toHaveLength(0);
    });

    it("keeps the user's pending CIBA requests when the code cannot be issued after sign-in", async () => {
      const userId = await createUserWithOpaque(TEST_EMAIL);
      const { requestId } = await createTestCibaRequest({
        clientId: TEST_CLIENT_ID,
        userId,
      });
      const { code_challenge, code_challenge_method, ...withoutPkce } =
        initialRequest();
      const round1 = await challenge(key, withoutPkce);
      expect(round1.json.challenge_type).toBe("opaque");

      const round3 = await answerOpaque(
        key,
        round1.json.auth_session as string
      );

      expect(round3.status).toBe(400);
      expect(round3.json.authorization_code).toBeUndefined();
      expect(
        await db
          .select()
          .from(sessions)
          .where(eq(sessions.userId, userId))
          .all()
      ).toHaveLength(0);
      expect(
        await db
          .select()
          .from(authenticationContexts)
          .where(eq(authenticationContexts.userId, userId))
          .all()
      ).toHaveLength(0);
      const pending = await db
        .select({ status: cibaRequests.status })
        .from(cibaRequests)
        .where(eq(cibaRequests.id, requestId))
        .get();
      expect(pending?.status).toBe("pending");
    });
  });

  describe("Sign-In with Ethereum", () => {
    /** Round 1 of a wallet sign-in for `address` on a new auth_session. */
    async function startWallet(address: string = TEST_WALLET.address) {
      const round1 = await challenge(
        key,
        initialRequest({ login_hint: address })
      );
      if (round1.json.challenge_type !== "siwe") {
        throw new Error(`Expected a wallet challenge: ${round1.status}`);
      }
      return {
        authSession: round1.json.auth_session as string,
        message: round1.json.message as string,
      };
    }

    it("names the app origin in the message and keeps the auth_session out of it", async () => {
      await createWalletUser(TEST_WALLET.address);
      const { authSession, message } = await startWallet();
      const appUrl = new URL(env.NEXT_PUBLIC_APP_URL);

      expect(parseSiweMessage(message)).toMatchObject({
        address: TEST_WALLET.address,
        chainId: 1,
        domain: appUrl.host,
        requestId: expect.any(String),
        statement: "Sign in to Zentity from a first-party app.",
        uri: appUrl.origin,
      });
      expect(message).not.toContain(authSession);
    });

    it("issues a code in two rounds for an EIP-191 signature and redeems it for DPoP-bound tokens", async () => {
      const userId = await createWalletUser(TEST_WALLET.address);
      const round1 = await challenge(
        key,
        initialRequest({ login_hint: TEST_WALLET.address })
      );
      const authSession = round1.json.auth_session as string;

      const round2 = await challenge(
        key,
        {
          auth_session: authSession,
          siwe_signature: await signChallenge(TEST_WALLET, round1.json),
        },
        { json: true }
      );
      expect(round2.status).toBe(200);

      const token = await redeem(key, round2.json.authorization_code as string);
      expect(token.status).toBe(200);
      expect(token.json.auth_session).toEqual(expect.any(String));
      expect(decodeJwt(token.json.id_token as string).amr).toEqual([
        "pop",
        "hwk",
      ]);
      const contexts = await db
        .select({ sourceKind: authenticationContexts.sourceKind })
        .from(authenticationContexts)
        .where(eq(authenticationContexts.userId, userId))
        .all();
      expect(contexts).toEqual([{ sourceKind: "authorize_challenge_eip712" }]);
    });

    it("answers a wrong signature with a new message", async () => {
      await createWalletUser(TEST_WALLET.address);
      const round1 = await challenge(
        key,
        initialRequest({ login_hint: TEST_WALLET.address })
      );

      const round2 = await challenge(
        key,
        {
          auth_session: round1.json.auth_session as string,
          siwe_signature: await signChallenge(UNKNOWN_WALLET, round1.json),
        },
        { json: true }
      );

      expect(round2.status).toBe(400);
      expect(round2.json.error).toBe("authentication_failed");
      expect(round2.json.message).toEqual(expect.any(String));
      expect(round2.json.message).not.toBe(round1.json.message);
    });

    it("answers a malformed signature with authentication_failed", async () => {
      await createWalletUser(TEST_WALLET.address);
      const { authSession } = await startWallet();

      const round2 = await challenge(
        key,
        {
          auth_session: authSession,
          siwe_signature: `0x${"00".repeat(65)}`,
        },
        { json: true }
      );

      expect(round2.status).toBe(400);
      expect(round2.json.error).toBe("authentication_failed");
    });

    it("refuses a signature over a message whose nonce has expired", async () => {
      await createWalletUser(TEST_WALLET.address);
      const { authSession, message } = await startWallet();
      const signature = await TEST_WALLET.signMessage({ message });
      await db
        .update(verifications)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(
          eq(
            verifications.identifier,
            `siwe:${parseSiweMessage(message).nonce}`
          )
        )
        .run();

      const round2 = await challenge(
        key,
        { auth_session: authSession, siwe_signature: signature },
        { json: true }
      );

      expect(round2.status).toBe(400);
      expect(round2.json.error).toBe("authentication_failed");
      expect(round2.json.authorization_code).toBeUndefined();
    });

    it("refuses the signature of another auth_session's challenge", async () => {
      await createWalletUser(TEST_WALLET.address);
      const first = await startWallet();
      const second = await startWallet();

      const round2 = await challenge(
        key,
        {
          auth_session: second.authSession,
          siwe_signature: await TEST_WALLET.signMessage({
            message: first.message,
          }),
        },
        { json: true }
      );

      expect(round2.status).toBe(400);
      expect(round2.json.error).toBe("authentication_failed");
    });

    it("refuses a browser sign-in signature", async () => {
      await createWalletUser(TEST_WALLET.address);
      const { authSession } = await startWallet();
      const signIn = await auth.handler(
        new Request("http://localhost:3000/api/auth/sign-in/siwe/challenge", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ address: TEST_WALLET.address, chainId: 1 }),
        })
      );
      const { message } = (await signIn.json()) as { message: string };

      const round2 = await challenge(
        key,
        {
          auth_session: authSession,
          siwe_signature: await TEST_WALLET.signMessage({ message }),
        },
        { json: true }
      );

      expect(round2.status).toBe(400);
      expect(round2.json.error).toBe("authentication_failed");
    });

    it("is not accepted by browser sign-in", async () => {
      await createWalletUser(TEST_WALLET.address);
      const { message } = await startWallet();

      const response = await auth.handler(
        new Request("http://localhost:3000/api/auth/sign-in/siwe/complete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message,
            signature: await TEST_WALLET.signMessage({ message }),
          }),
        })
      );

      expect(response.status).toBe(401);
      expect(response.headers.get("set-cookie")).toBeNull();
    });

    it("issues one code when the same signed challenge is finished concurrently", async () => {
      await createWalletUser(TEST_WALLET.address);
      const round1 = await challenge(
        key,
        initialRequest({ login_hint: TEST_WALLET.address })
      );
      const answer = {
        auth_session: round1.json.auth_session as string,
        siwe_signature: await signChallenge(TEST_WALLET, round1.json),
      };

      const results = await Promise.all(
        Array.from({ length: 4 }, () => challenge(key, answer, { json: true }))
      );

      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      expect(
        results.filter((r) => typeof r.json.authorization_code === "string")
      ).toHaveLength(1);
    });

    it("refuses a signed challenge once its auth_session has expired", async () => {
      await createWalletUser(TEST_WALLET.address);
      const round1 = await challenge(
        key,
        initialRequest({ login_hint: TEST_WALLET.address })
      );
      const signature = await signChallenge(TEST_WALLET, round1.json);
      await db
        .update(firstPartyAuthSessions)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .run();

      const round2 = await challenge(
        key,
        {
          auth_session: round1.json.auth_session as string,
          siwe_signature: signature,
        },
        { json: true }
      );

      expect(round2.status).toBe(400);
      expect(round2.json.error).toBe("invalid_session");
      expect(round2.json.authorization_code).toBeUndefined();
    });

    it("never signs in an unknown address, even with its own valid signature", async () => {
      const round1 = await challenge(
        key,
        initialRequest({ login_hint: UNKNOWN_WALLET.address })
      );

      const round2 = await challenge(
        key,
        {
          auth_session: round1.json.auth_session as string,
          siwe_signature: await signChallenge(UNKNOWN_WALLET, round1.json),
        },
        { json: true }
      );

      expect(round2.status).toBe(400);
      expect(round2.json.error).toBe("authentication_failed");
    });

    it("locks the account's native sign-in after ten failures across auth_sessions", async () => {
      await createWalletUser(TEST_WALLET.address);
      const wrongSignature = (challengeBody: Json) =>
        signChallenge(UNKNOWN_WALLET, challengeBody);
      let failures = 0;
      while (failures < 10) {
        const round1 = await challenge(
          key,
          initialRequest({ login_hint: TEST_WALLET.address })
        );
        let current = round1.json;
        for (let attempt = 0; attempt < 3 && failures < 10; attempt++) {
          const answer = await challenge(
            key,
            {
              auth_session: round1.json.auth_session as string,
              siwe_signature: await wrongSignature(current),
            },
            { json: true }
          );
          failures++;
          current = answer.json;
        }
      }

      const round1 = await challenge(
        key,
        initialRequest({ login_hint: TEST_WALLET.address })
      );
      const correct = await challenge(
        key,
        {
          auth_session: round1.json.auth_session as string,
          siwe_signature: await signChallenge(TEST_WALLET, round1.json),
        },
        { json: true }
      );

      expect(correct.status).toBe(400);
      expect(correct.json.error).toBe("authentication_failed");
    });
  });

  describe("cleanup", () => {
    it("deletes expired auth_session rows and failure budgets on the next request", async () => {
      const past = new Date(Date.now() - 1000);
      const future = new Date(Date.now() + 60_000);
      const authSessionRow = (handle: string, expiresAt: Date) => ({
        authSession: handle,
        clientId: TEST_CLIENT_ID,
        state: "pending" as const,
        request: "{}",
        expiresAt,
        createdAt: past,
        updatedAt: past,
      });
      await db
        .insert(firstPartyAuthSessions)
        .values([
          authSessionRow("expired", past),
          authSessionRow("live", future),
        ])
        .run();
      await db
        .insert(firstPartyFailureBudgets)
        .values([
          { key: "expired", failures: 3, resetAt: past },
          { key: "live", failures: 3, resetAt: future },
        ])
        .run();

      await challenge(
        key,
        initialRequest({ login_hint: "nobody@example.com" })
      );

      const handles = (await countRows()).map((row) => row.authSession);
      expect(handles).toContain("live");
      expect(handles).not.toContain("expired");
      const budgets = await db
        .select({ key: firstPartyFailureBudgets.key })
        .from(firstPartyFailureBudgets)
        .all();
      expect(budgets).toEqual([{ key: "live" }]);
    });
  });

  describe("assurance tier policy", () => {
    it("keeps the sign-in while the tier is short and issues on that session once it rises", async () => {
      const userId = await createUserWithOpaque(TEST_EMAIL);

      const { authSession, round3 } = await signInWithOpaque(key, {
        acr_values: TIER_1,
      });
      expect(round3.status).toBe(403);
      expect(round3.json).toMatchObject({
        error: "insufficient_authorization",
        auth_session: authSession,
      });
      expect(round3.json.challenge_type).toBeUndefined();
      expect(round3.json.error_description).toContain("tier-0");

      const stillShort = await challenge(
        key,
        { auth_session: authSession },
        { json: true }
      );
      expect(stillShort.status).toBe(403);
      expect(stillShort.json.challenge_type).toBeUndefined();

      await seedTier1(userId);
      const retry = await challenge(
        key,
        { auth_session: authSession },
        { json: true }
      );
      expect(retry.status).toBe(200);

      const token = await redeem(key, retry.json.authorization_code as string);
      expect(token.status).toBe(200);
      expect(decodeJwt(token.json.id_token as string).acr).toBe(TIER_1);
      // The retry reused the session the password created and asserted no
      // new sign-in.
      expect(
        await db
          .select()
          .from(sessions)
          .where(eq(sessions.userId, userId))
          .all()
      ).toHaveLength(1);
      expect(
        await db
          .select()
          .from(authenticationContexts)
          .where(eq(authenticationContexts.userId, userId))
          .all()
      ).toHaveLength(1);
    });
  });

  describe("step-up from a CIBA token poll", () => {
    const CIBA_GRANT_TYPE = "urn:openid:params:grant-type:ciba";
    const AGENT_ID = "fpa-ciba-agent";
    const AGENT_SECRET = "fpa-ciba-agent-secret";
    const agentAuth = { client_id: AGENT_ID, client_secret: AGENT_SECRET };

    beforeEach(async () => {
      await createClient(AGENT_ID, {
        clientSecret: crypto
          .createHash("sha256")
          .update(AGENT_SECRET)
          .digest("base64url"),
        grantTypes: JSON.stringify([CIBA_GRANT_TYPE, "authorization_code"]),
        tokenEndpointAuthMethod: "client_secret_post",
      });
    });

    it("signs the user in again on the poll's key and issues a code once the tier rises", async () => {
      const userId = await createUserWithOpaque(TEST_EMAIL);
      const { authReqId } = await createTestCibaRequest({
        clientId: AGENT_ID,
        userId,
        status: "approved",
        acrValues: JSON.stringify([TIER_1]),
      });

      const poll = await postTokenWithDpop(
        {
          ...agentAuth,
          grant_type: CIBA_GRANT_TYPE,
          auth_req_id: authReqId,
        },
        key
      );
      expect(poll.status).toBe(403);
      expect(poll.json.error).toBe("insufficient_authorization");
      const authSession = poll.json.auth_session as string;

      const start = await challenge(
        key,
        {
          ...agentAuth,
          auth_session: authSession,
          code_challenge: CODE_CHALLENGE,
          code_challenge_method: "S256",
        },
        { json: true }
      );
      expect(start.status).toBe(403);
      expect(start.json.challenge_type).toBe("opaque");

      const signedIn = await answerOpaque(key, authSession, agentAuth);
      expect(signedIn.status).toBe(403);
      expect(signedIn.json.error).toBe("insufficient_authorization");

      await seedTier1(userId);
      const retry = await challenge(
        key,
        { ...agentAuth, auth_session: authSession },
        { json: true }
      );
      expect(retry.status).toBe(200);

      const token = await redeem(
        key,
        retry.json.authorization_code as string,
        agentAuth
      );
      expect(token.status).toBe(200);
      expect(token.json.token_type).toBe("DPoP");
    });

    it("signs a wallet user in again with Sign-In with Ethereum on the poll's key", async () => {
      const userId = await createWalletUser(TEST_WALLET.address);
      const { authReqId } = await createTestCibaRequest({
        clientId: AGENT_ID,
        userId,
        status: "approved",
        acrValues: JSON.stringify([TIER_1]),
      });
      const poll = await postTokenWithDpop(
        {
          ...agentAuth,
          grant_type: CIBA_GRANT_TYPE,
          auth_req_id: authReqId,
        },
        key
      );
      expect(poll.status).toBe(403);
      const authSession = poll.json.auth_session as string;

      const start = await challenge(
        key,
        {
          ...agentAuth,
          auth_session: authSession,
          code_challenge: CODE_CHALLENGE,
          code_challenge_method: "S256",
        },
        { json: true }
      );
      expect(start.status).toBe(403);
      expect(start.json.challenge_type).toBe("siwe");

      const signedIn = await challenge(
        key,
        {
          ...agentAuth,
          auth_session: authSession,
          siwe_signature: await signChallenge(TEST_WALLET, start.json),
        },
        { json: true }
      );
      expect(signedIn.status).toBe(403);
      expect(signedIn.json.error).toBe("insufficient_authorization");
      expect(signedIn.json.challenge_type).toBeUndefined();

      await seedTier1(userId);
      const retry = await challenge(
        key,
        { ...agentAuth, auth_session: authSession },
        { json: true }
      );
      expect(retry.status).toBe(200);
      expect(retry.json.authorization_code).toEqual(expect.any(String));
    });

    it("refuses a follow-up from another key before it starts a challenge", async () => {
      const userId = await createUserWithOpaque(TEST_EMAIL);
      const { authReqId } = await createTestCibaRequest({
        clientId: AGENT_ID,
        userId,
        status: "approved",
        acrValues: JSON.stringify([TIER_1]),
      });
      const poll = await postTokenWithDpop(
        {
          ...agentAuth,
          grant_type: CIBA_GRANT_TYPE,
          auth_req_id: authReqId,
        },
        key
      );

      const { json, status } = await challenge(
        await createTestDpopKeyPair(),
        { ...agentAuth, auth_session: poll.json.auth_session as string },
        { json: true }
      );

      expect(status).toBe(400);
      expect(json.error).toBe("invalid_dpop_proof");
      expect(json.server_public_key).toBeUndefined();
    });
  });
});
