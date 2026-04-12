import crypto from "node:crypto";

import {
  calculateJwkThumbprint,
  decodeJwt,
  exportJWK,
  generateKeyPair,
  SignJWT,
} from "jose";
import { beforeEach, describe, expect, it } from "vitest";

import { computeAtHash } from "@/lib/assurance/oidc-claims";
import {
  AUTHENTICATION_CONTEXT_CLAIM,
  createAuthenticationContext,
} from "@/lib/auth/authentication-context";
import { computePairwiseSub } from "@/lib/auth/oidc/pairwise";
import { TOKEN_EXCHANGE_GRANT_TYPE } from "@/lib/auth/oidc/token-exchange";
import { getAuthIssuer } from "@/lib/auth/well-known";

const PURCHASE_AUTHORIZATION_TOKEN_TYPE =
  "urn:zentity:token-type:purchase-authorization";

import { resolveAgentSubForClient } from "@/lib/ciba/pairwise-agent";
import { db } from "@/lib/db/connection";
import { agentHosts, agentSessions } from "@/lib/db/schema/agent";
import { sessions } from "@/lib/db/schema/auth";
import { identityBundles } from "@/lib/db/schema/identity";
import { jwks as jwksTable } from "@/lib/db/schema/jwks";
import { oauthClients } from "@/lib/db/schema/oauth-provider";
import { createTestUser, resetDatabase } from "@/test/db-test-utils";
import { postTokenWithDpop } from "@/test/dpop-test-utils";

const ACCESS_TOKEN_TYPE = "urn:ietf:params:oauth:token-type:access_token";
const ID_TOKEN_TYPE = "urn:ietf:params:oauth:token-type:id_token";
const TEST_CLIENT_ID = "exchange-test-agent";
const authIssuer = getAuthIssuer();

let testKeyPair: Awaited<ReturnType<typeof generateKeyPair>>;
let testKid: string;
let defaultAuthContextId: string;

async function ensureSigningKey() {
  testKeyPair = await generateKeyPair("EdDSA", {
    crv: "Ed25519",
    extractable: true,
  });
  testKid = crypto.randomUUID();
  const publicJwk = await exportJWK(testKeyPair.publicKey);
  const privateJwk = await exportJWK(testKeyPair.privateKey);
  await db
    .insert(jwksTable)
    .values({
      id: testKid,
      publicKey: JSON.stringify(publicJwk),
      privateKey: JSON.stringify(privateJwk),
      alg: "EdDSA",
      crv: "Ed25519",
    })
    .run();
}

async function createTestClient(clientId = TEST_CLIENT_ID) {
  await db
    .insert(oauthClients)
    .values({
      clientId,
      name: "Exchange Test Agent",
      redirectUris: JSON.stringify(["http://localhost/callback"]),
      grantTypes: JSON.stringify([TOKEN_EXCHANGE_GRANT_TYPE]),
      tokenEndpointAuthMethod: "none",
      public: true,
    })
    .run();
}

function mintAccessToken(
  sub: string,
  opts: {
    aap?: Record<string, unknown>;
    scope?: string;
    act?: Record<string, unknown>;
    authContextId?: string;
    authorizationDetails?: unknown;
    azp?: string;
    exp?: number;
  } = {}
): Promise<string> {
  const payload: Record<string, unknown> = {
    iss: authIssuer,
    sub,
    aud: authIssuer,
    jti: crypto.randomUUID(),
    scope: opts.scope ?? "openid",
    azp: opts.azp ?? TEST_CLIENT_ID,
    iat: Math.floor(Date.now() / 1000),
    exp: opts.exp ?? Math.floor(Date.now() / 1000) + 3600,
    [AUTHENTICATION_CONTEXT_CLAIM]: opts.authContextId ?? defaultAuthContextId,
    ...(opts.aap ?? {}),
  };
  if (opts.act) {
    payload.act = opts.act;
  }
  if (opts.authorizationDetails) {
    payload.authorization_details = opts.authorizationDetails;
  }
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "EdDSA", typ: "JWT", kid: testKid })
    .sign(testKeyPair.privateKey);
}

function mintIdToken(
  sub: string,
  aud: string = TEST_CLIENT_ID,
  authContextId = defaultAuthContextId
): Promise<string> {
  const payload: Record<string, unknown> = {
    iss: authIssuer,
    sub,
    aud,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
    [AUTHENTICATION_CONTEXT_CLAIM]: authContextId,
  };
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "EdDSA", typ: "JWT", kid: testKid })
    .sign(testKeyPair.privateKey);
}

describe("Token Exchange (RFC 8693)", () => {
  let userId: string;

  beforeEach(async () => {
    await resetDatabase();
    userId = await createTestUser();
    defaultAuthContextId = (
      await createAuthenticationContext({
        userId,
        loginMethod: "passkey",
        authenticatedAt: new Date(),
        sourceKind: "token_exchange",
      })
    ).id;
    await ensureSigningKey();
    await createTestClient();
  });

  describe("access token → access token", () => {
    it("exchanges with scope attenuation", async () => {
      const subjectToken = await mintAccessToken(userId, {
        scope: "openid identity.name identity.dob",
      });

      const { status, json } = await postTokenWithDpop({
        grant_type: TOKEN_EXCHANGE_GRANT_TYPE,
        client_id: TEST_CLIENT_ID,
        subject_token: subjectToken,
        subject_token_type: ACCESS_TOKEN_TYPE,
        scope: "openid identity.name",
      });

      expect(status).toBe(200);
      expect(json.issued_token_type).toBe(ACCESS_TOKEN_TYPE);
      expect(json.token_type).toBe("DPoP");
      expect(json.scope).toBe("openid identity.name");

      const payload = decodeJwt(json.access_token as string);
      expect(payload.scope).toBe("openid identity.name");
      expect(payload.act).toEqual({ sub: TEST_CLIENT_ID });
    });

    it("binds audience to resource parameter", async () => {
      const subjectToken = await mintAccessToken(userId);
      const merchantApi = "https://merchant.example.com/api";

      const { status, json } = await postTokenWithDpop({
        grant_type: TOKEN_EXCHANGE_GRANT_TYPE,
        client_id: TEST_CLIENT_ID,
        subject_token: subjectToken,
        subject_token_type: ACCESS_TOKEN_TYPE,
        resource: merchantApi,
      });

      expect(status).toBe(200);
      const payload = decodeJwt(json.access_token as string);
      expect(payload.aud).toBe(merchantApi);
    });

    it("binds audience to audience parameter when resource is absent", async () => {
      const subjectToken = await mintAccessToken(userId);
      const targetService = "https://target.example.com";

      const { status, json } = await postTokenWithDpop({
        grant_type: TOKEN_EXCHANGE_GRANT_TYPE,
        client_id: TEST_CLIENT_ID,
        subject_token: subjectToken,
        subject_token_type: ACCESS_TOKEN_TYPE,
        audience: targetService,
      });

      expect(status).toBe(200);
      const payload = decodeJwt(json.access_token as string);
      expect(payload.aud).toBe(targetService);
    });

    it("prefers resource over audience for aud binding", async () => {
      const subjectToken = await mintAccessToken(userId);

      const { status, json } = await postTokenWithDpop({
        grant_type: TOKEN_EXCHANGE_GRANT_TYPE,
        client_id: TEST_CLIENT_ID,
        subject_token: subjectToken,
        subject_token_type: ACCESS_TOKEN_TYPE,
        resource: "https://resource.example.com",
        audience: "https://audience.example.com",
      });

      expect(status).toBe(200);
      const payload = decodeJwt(json.access_token as string);
      expect(payload.aud).toBe("https://resource.example.com");
    });

    it("inherits subject scopes when none requested", async () => {
      const subjectToken = await mintAccessToken(userId, {
        scope: "openid identity.name",
      });

      const { status, json } = await postTokenWithDpop({
        grant_type: TOKEN_EXCHANGE_GRANT_TYPE,
        client_id: TEST_CLIENT_ID,
        subject_token: subjectToken,
        subject_token_type: ACCESS_TOKEN_TYPE,
      });

      expect(status).toBe(200);
      expect(json.scope).toBe("openid identity.name");
    });

    it("preserves AAP claims and adds delegation on exchanged tokens", async () => {
      const subjectToken = await mintAccessToken(userId, {
        scope: "openid",
        aap: {
          agent: {
            id: "pairwise-agent-subject",
            type: "mcp-agent",
            model: { id: "gpt-4", version: "1.0.0" },
            runtime: { environment: "demo-rp", attested: true },
          },
          task: {
            id: "task-123",
            purpose: "purchase",
          },
          capabilities: [
            {
              action: "purchase",
              constraints: [{ field: "merchant", op: "eq", value: "Wine.com" }],
            },
          ],
          oversight: {
            approval_reference: "grant-123",
            requires_human_approval_for: ["purchase"],
          },
          audit: {
            trace_id: "trace-123",
            session_id: "pairwise-agent-subject",
          },
        },
      });

      const parentPayload = decodeJwt(subjectToken);

      const { status, json } = await postTokenWithDpop({
        grant_type: TOKEN_EXCHANGE_GRANT_TYPE,
        client_id: TEST_CLIENT_ID,
        subject_token: subjectToken,
        subject_token_type: ACCESS_TOKEN_TYPE,
      });

      expect(status).toBe(200);
      const payload = decodeJwt(json.access_token as string);

      expect(payload.agent).toEqual(parentPayload.agent);
      expect(payload.task).toEqual(parentPayload.task);
      expect(payload.capabilities).toEqual(parentPayload.capabilities);
      expect(payload.oversight).toEqual(parentPayload.oversight);
      expect(payload.audit).toEqual(parentPayload.audit);
      expect(payload.delegation).toEqual({
        depth: 1,
        chain: ["pairwise-agent-subject"],
        parent_jti: parentPayload.jti,
      });
    });
  });

  describe("access token → purchase authorization artifact", () => {
    it("issues a purchase-authorization+jwt for the requested audience client", async () => {
      const facilitatorClientId = "merchant-facilitator";
      await createTestClient(facilitatorClientId);

      const [host] = await db
        .insert(agentHosts)
        .values({
          userId,
          clientId: TEST_CLIENT_ID,
          publicKey: JSON.stringify({ crv: "Ed25519", kty: "OKP", x: "host" }),
          publicKeyThumbprint: "host-thumbprint",
          name: "Test Host",
        })
        .returning({ id: agentHosts.id });
      expect(host).toBeDefined();
      if (!host) {
        throw new Error("Expected host registration fixture to be created");
      }
      const [session] = await db
        .insert(agentSessions)
        .values({
          hostId: host.id,
          publicKey: JSON.stringify({ crv: "Ed25519", kty: "OKP", x: "agent" }),
          publicKeyThumbprint: "agent-thumbprint",
          displayName: "Test Agent",
        })
        .returning({ id: agentSessions.id });
      expect(session).toBeDefined();
      if (!session) {
        throw new Error("Expected agent session fixture to be created");
      }

      const subjectToken = await mintAccessToken(userId, {
        azp: TEST_CLIENT_ID,
        act: {
          sub: await resolveAgentSubForClient(session.id, TEST_CLIENT_ID),
        },
        authorizationDetails: [
          {
            type: "purchase",
            amount: { value: "48.50", currency: "USD" },
            merchant: "Wine.com",
            item: "Merlot",
          },
        ],
      });

      const { dpopKeyPair, status, json } = await postTokenWithDpop({
        grant_type: TOKEN_EXCHANGE_GRANT_TYPE,
        client_id: TEST_CLIENT_ID,
        subject_token: subjectToken,
        subject_token_type: ACCESS_TOKEN_TYPE,
        requested_token_type: PURCHASE_AUTHORIZATION_TOKEN_TYPE,
        audience: facilitatorClientId,
      });

      expect(status).toBe(200);
      expect(json.issued_token_type).toBe(PURCHASE_AUTHORIZATION_TOKEN_TYPE);
      expect(json.token_type).toBe("N_A");

      const payload = decodeJwt(json.access_token as string);
      expect(payload.aud).toBe(facilitatorClientId);
      expect(payload.authorization_details).toEqual([
        {
          type: "purchase",
          amount: { value: "48.50", currency: "USD" },
          merchant: "Wine.com",
          item: "Merlot",
        },
      ]);
      expect(payload.act).toEqual({
        sub: await resolveAgentSubForClient(session.id, facilitatorClientId),
      });
      expect(payload.cnf).toEqual({
        jkt: await calculateJwkThumbprint(dpopKeyPair.jwk, "sha256"),
      });
    });

    it("caps the artifact lifetime to the subject token lifetime", async () => {
      const facilitatorClientId = "merchant-facilitator";
      await createTestClient(facilitatorClientId);

      const [host] = await db
        .insert(agentHosts)
        .values({
          userId,
          clientId: TEST_CLIENT_ID,
          publicKey: JSON.stringify({ crv: "Ed25519", kty: "OKP", x: "host" }),
          publicKeyThumbprint: "host-thumbprint",
          name: "Test Host",
        })
        .returning({ id: agentHosts.id });
      if (!host) {
        throw new Error("Expected host registration fixture to be created");
      }

      const [session] = await db
        .insert(agentSessions)
        .values({
          hostId: host.id,
          publicKey: JSON.stringify({ crv: "Ed25519", kty: "OKP", x: "agent" }),
          publicKeyThumbprint: "agent-thumbprint",
          displayName: "Test Agent",
        })
        .returning({ id: agentSessions.id });
      if (!session) {
        throw new Error("Expected agent session fixture to be created");
      }

      const subjectExp = Math.floor(Date.now() / 1000) + 120;
      const subjectToken = await mintAccessToken(userId, {
        azp: TEST_CLIENT_ID,
        exp: subjectExp,
        act: {
          sub: await resolveAgentSubForClient(session.id, TEST_CLIENT_ID),
        },
        authorizationDetails: [
          {
            type: "purchase",
            amount: { value: "48.50", currency: "USD" },
            merchant: "Wine.com",
            item: "Merlot",
          },
        ],
      });

      const { status, json } = await postTokenWithDpop({
        grant_type: TOKEN_EXCHANGE_GRANT_TYPE,
        client_id: TEST_CLIENT_ID,
        subject_token: subjectToken,
        subject_token_type: ACCESS_TOKEN_TYPE,
        requested_token_type: PURCHASE_AUTHORIZATION_TOKEN_TYPE,
        audience: facilitatorClientId,
      });

      expect(status).toBe(200);

      const payload = decodeJwt(json.access_token as string);
      expect(payload.exp).toBe(subjectExp);
      expect(json.expires_in).toBeLessThanOrEqual(120);
    });
  });

  describe("access token → id_token", () => {
    it("returns a valid id_token with act claim and at_hash", async () => {
      const subjectToken = await mintAccessToken(userId);

      const { status, json } = await postTokenWithDpop({
        grant_type: TOKEN_EXCHANGE_GRANT_TYPE,
        client_id: TEST_CLIENT_ID,
        subject_token: subjectToken,
        subject_token_type: ACCESS_TOKEN_TYPE,
        requested_token_type: ID_TOKEN_TYPE,
      });

      expect(status).toBe(200);
      expect(json.issued_token_type).toBe(ID_TOKEN_TYPE);
      expect(json.token_type).toBe("N_A");

      const payload = decodeJwt(json.access_token as string);
      expect(payload.sub).toBe(userId);
      expect(payload.iss).toBe(authIssuer);
      expect(payload.aud).toBe(TEST_CLIENT_ID);
      expect(payload.act).toEqual({ sub: TEST_CLIENT_ID });
      expect(payload[AUTHENTICATION_CONTEXT_CLAIM]).toBe(defaultAuthContextId);

      // at_hash binds the id_token to the subject access token (OIDC Core §3.3.2.11)
      const expectedAtHash = computeAtHash(subjectToken, "RS256");
      expect(payload.at_hash).toBe(expectedAtHash);
    });

    it("includes assurance claims (acr, acr_eidas, amr, auth_time)", async () => {
      // Seed tier-1 user: identity bundle with FHE keys
      await db
        .insert(identityBundles)
        .values({
          userId,
          fheKeyId: "test-fhe-key-id",
          fheStatus: "complete",
          status: "verified",
        })
        .run();

      const authContext = await createAuthenticationContext({
        userId,
        loginMethod: "passkey",
        authenticatedAt: new Date(),
        sourceKind: "better_auth",
        sourceSessionId: crypto.randomUUID(),
        referenceType: "session",
      });

      // Seed a passkey-authenticated session so the exchanged ID token can
      // resolve trusted auth provenance.
      await db
        .insert(sessions)
        .values({
          id: crypto.randomUUID(),
          userId,
          token: crypto.randomUUID(),
          authContextId: authContext.id,
          expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
        .run();

      const subjectToken = await mintAccessToken(userId);

      const { status, json } = await postTokenWithDpop({
        grant_type: TOKEN_EXCHANGE_GRANT_TYPE,
        client_id: TEST_CLIENT_ID,
        subject_token: subjectToken,
        subject_token_type: ACCESS_TOKEN_TYPE,
        requested_token_type: ID_TOKEN_TYPE,
      });

      expect(status).toBe(200);
      const payload = decodeJwt(json.access_token as string);
      expect(payload.acr).toBe("urn:zentity:assurance:tier-1");
      expect(payload.acr_eidas).toBe("http://eidas.europa.eu/LoA/low");
      expect(payload.amr).toEqual(["pop", "hwk", "user"]);
      expect(payload.auth_time).toBeDefined();
      expect(typeof payload.auth_time).toBe("number");
    });
  });

  describe("id_token → id_token", () => {
    it("omits at_hash when subject is not an access token", async () => {
      const subjectIdToken = await mintIdToken(userId);

      const { status, json } = await postTokenWithDpop({
        grant_type: TOKEN_EXCHANGE_GRANT_TYPE,
        client_id: TEST_CLIENT_ID,
        subject_token: subjectIdToken,
        subject_token_type: ID_TOKEN_TYPE,
        requested_token_type: ID_TOKEN_TYPE,
      });

      expect(status).toBe(200);
      expect(json.issued_token_type).toBe(ID_TOKEN_TYPE);

      const payload = decodeJwt(json.access_token as string);
      expect(payload.at_hash).toBeUndefined();
    });
  });

  describe("id_token → access token", () => {
    it("mints an access token from a valid id_token", async () => {
      const subjectIdToken = await mintIdToken(userId);

      const { status, json } = await postTokenWithDpop({
        grant_type: TOKEN_EXCHANGE_GRANT_TYPE,
        client_id: TEST_CLIENT_ID,
        subject_token: subjectIdToken,
        subject_token_type: ID_TOKEN_TYPE,
        requested_token_type: ACCESS_TOKEN_TYPE,
      });

      expect(status).toBe(200);
      expect(json.issued_token_type).toBe(ACCESS_TOKEN_TYPE);
      expect(json.token_type).toBe("DPoP");

      const payload = decodeJwt(json.access_token as string);
      expect(payload.sub).toBe(userId);
      expect(payload.act).toEqual({ sub: TEST_CLIENT_ID });
    });
  });

  describe("id_token scope defaults", () => {
    it("defaults to openid when no scope requested", async () => {
      const subjectIdToken = await mintIdToken(userId);

      const { status, json } = await postTokenWithDpop({
        grant_type: TOKEN_EXCHANGE_GRANT_TYPE,
        client_id: TEST_CLIENT_ID,
        subject_token: subjectIdToken,
        subject_token_type: ID_TOKEN_TYPE,
        requested_token_type: ACCESS_TOKEN_TYPE,
      });

      expect(status).toBe(200);
      expect(json.scope).toBe("openid");
      const payload = decodeJwt(json.access_token as string);
      expect(payload.scope).toBe("openid");
    });
  });

  describe("scope attenuation enforcement", () => {
    it("rejects scope broadening on access token subjects", async () => {
      const subjectToken = await mintAccessToken(userId, {
        scope: "openid",
      });

      const { status, json } = await postTokenWithDpop({
        grant_type: TOKEN_EXCHANGE_GRANT_TYPE,
        client_id: TEST_CLIENT_ID,
        subject_token: subjectToken,
        subject_token_type: ACCESS_TOKEN_TYPE,
        scope: "openid identity.name",
      });

      expect(status).toBe(400);
      expect(json.error).toBe("invalid_scope");
    });

    it("rejects non-openid scopes on id_token subjects", async () => {
      const subjectIdToken = await mintIdToken(userId);

      const { status, json } = await postTokenWithDpop({
        grant_type: TOKEN_EXCHANGE_GRANT_TYPE,
        client_id: TEST_CLIENT_ID,
        subject_token: subjectIdToken,
        subject_token_type: ID_TOKEN_TYPE,
        scope: "openid identity.name",
      });

      expect(status).toBe(400);
      expect(json.error).toBe("invalid_scope");
    });
  });

  describe("act claim nesting", () => {
    it("nests act claims across multiple exchanges", async () => {
      // First exchange: agent A gets a token with act: { sub: "agent-a" }
      const agentAId = "agent-a";
      await createTestClient(agentAId);

      const originalToken = await mintAccessToken(userId, {
        scope: "openid identity.name",
      });

      const { json: firstExchange } = await postTokenWithDpop({
        grant_type: TOKEN_EXCHANGE_GRANT_TYPE,
        client_id: agentAId,
        subject_token: originalToken,
        subject_token_type: ACCESS_TOKEN_TYPE,
        scope: "openid identity.name",
      });

      const firstPayload = decodeJwt(firstExchange.access_token as string);
      expect(firstPayload.act).toEqual({ sub: agentAId });

      // Second exchange: agent B exchanges agent A's token
      const agentBId = "agent-b";
      await createTestClient(agentBId);

      const { status, json: secondExchange } = await postTokenWithDpop({
        grant_type: TOKEN_EXCHANGE_GRANT_TYPE,
        client_id: agentBId,
        subject_token: firstExchange.access_token as string,
        subject_token_type: ACCESS_TOKEN_TYPE,
        scope: "openid",
      });

      expect(status).toBe(200);
      const secondPayload = decodeJwt(secondExchange.access_token as string);
      expect(secondPayload.act).toEqual({
        sub: agentBId,
        act: { sub: agentAId },
      });
    });
  });

  describe("pairwise subject identifiers", () => {
    const PAIRWISE_CLIENT_ID = "pairwise-exchange-agent";
    const PAIRWISE_REDIRECT = "https://pairwise-rp.example.com/callback";

    async function createPairwiseClient() {
      await db
        .insert(oauthClients)
        .values({
          clientId: PAIRWISE_CLIENT_ID,
          name: "Pairwise Exchange Agent",
          redirectUris: JSON.stringify([PAIRWISE_REDIRECT]),
          grantTypes: JSON.stringify([TOKEN_EXCHANGE_GRANT_TYPE]),
          tokenEndpointAuthMethod: "none",
          public: true,
          subjectType: "pairwise",
        })
        .run();
    }

    it("uses pairwise sub in access token output", async () => {
      await createPairwiseClient();
      const subjectToken = await mintAccessToken(userId);

      const { status, json } = await postTokenWithDpop({
        grant_type: TOKEN_EXCHANGE_GRANT_TYPE,
        client_id: PAIRWISE_CLIENT_ID,
        subject_token: subjectToken,
        subject_token_type: ACCESS_TOKEN_TYPE,
      });

      expect(status).toBe(200);
      const payload = decodeJwt(json.access_token as string);

      // Must NOT be the raw userId
      expect(payload.sub).not.toBe(userId);

      // Must match the deterministic pairwise computation
      const expectedSub = await computePairwiseSub(
        userId,
        [PAIRWISE_REDIRECT],
        process.env.PAIRWISE_SECRET as string
      );
      expect(payload.sub).toBe(expectedSub);
    });

    it("uses pairwise sub in id_token output", async () => {
      await createPairwiseClient();
      const subjectToken = await mintAccessToken(userId);

      const { status, json } = await postTokenWithDpop({
        grant_type: TOKEN_EXCHANGE_GRANT_TYPE,
        client_id: PAIRWISE_CLIENT_ID,
        subject_token: subjectToken,
        subject_token_type: ACCESS_TOKEN_TYPE,
        requested_token_type: ID_TOKEN_TYPE,
      });

      expect(status).toBe(200);
      const payload = decodeJwt(json.access_token as string);

      expect(payload.sub).not.toBe(userId);

      const expectedSub = await computePairwiseSub(
        userId,
        [PAIRWISE_REDIRECT],
        process.env.PAIRWISE_SECRET as string
      );
      expect(payload.sub).toBe(expectedSub);
    });

    it("preserves raw userId for public-subject clients", async () => {
      // Default test client is public-subject
      const subjectToken = await mintAccessToken(userId);

      const { status, json } = await postTokenWithDpop({
        grant_type: TOKEN_EXCHANGE_GRANT_TYPE,
        client_id: TEST_CLIENT_ID,
        subject_token: subjectToken,
        subject_token_type: ACCESS_TOKEN_TYPE,
      });

      expect(status).toBe(200);
      const payload = decodeJwt(json.access_token as string);
      expect(payload.sub).toBe(userId);
    });

    it("resolves pairwise id_token input to raw userId for user lookup", async () => {
      await createPairwiseClient();

      // Mint an id_token with pairwise sub (as if issued to the pairwise client)
      const pairwiseSub = await computePairwiseSub(
        userId,
        [PAIRWISE_REDIRECT],
        process.env.PAIRWISE_SECRET as string
      );
      const pairwiseIdToken = await mintIdToken(
        pairwiseSub,
        PAIRWISE_CLIENT_ID
      );

      const { status, json } = await postTokenWithDpop({
        grant_type: TOKEN_EXCHANGE_GRANT_TYPE,
        client_id: PAIRWISE_CLIENT_ID,
        subject_token: pairwiseIdToken,
        subject_token_type: ID_TOKEN_TYPE,
        requested_token_type: ACCESS_TOKEN_TYPE,
      });

      expect(status).toBe(200);
      // Output sub should also be pairwise (same client)
      const payload = decodeJwt(json.access_token as string);
      expect(payload.sub).toBe(pairwiseSub);
    });
  });

  describe("error cases", () => {
    it("rejects missing subject_token", async () => {
      const { status, json } = await postTokenWithDpop({
        grant_type: TOKEN_EXCHANGE_GRANT_TYPE,
        client_id: TEST_CLIENT_ID,
        subject_token_type: ACCESS_TOKEN_TYPE,
      });

      expect(status).toBe(400);
      expect(json.error).toBe("invalid_request");
    });

    it("rejects invalid/expired subject token", async () => {
      const expired = await new SignJWT({
        iss: authIssuer,
        sub: userId,
        scope: "openid",
        iat: Math.floor(Date.now() / 1000) - 7200,
        exp: Math.floor(Date.now() / 1000) - 3600,
      })
        .setProtectedHeader({ alg: "EdDSA", typ: "JWT", kid: testKid })
        .sign(testKeyPair.privateKey);

      const { status, json } = await postTokenWithDpop({
        grant_type: TOKEN_EXCHANGE_GRANT_TYPE,
        client_id: TEST_CLIENT_ID,
        subject_token: expired,
        subject_token_type: ACCESS_TOKEN_TYPE,
      });

      expect(status).toBe(400);
      expect(json.error).toBe("invalid_grant");
    });

    it("rejects unsupported subject_token_type", async () => {
      const subjectToken = await mintAccessToken(userId);

      const { status, json } = await postTokenWithDpop({
        grant_type: TOKEN_EXCHANGE_GRANT_TYPE,
        client_id: TEST_CLIENT_ID,
        subject_token: subjectToken,
        subject_token_type: "urn:ietf:params:oauth:token-type:refresh_token",
      });

      expect(status).toBe(400);
      expect(json.error).toBe("invalid_request");
    });
  });
});
