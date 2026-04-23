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
import { auth } from "@/lib/auth/auth-config";
import {
  AUTHENTICATION_CONTEXT_CLAIM,
  createAuthenticationContext,
} from "@/lib/auth/auth-context";
import {
  computePairwiseSub,
  resolveSubForClient,
} from "@/lib/auth/oidc/pairwise";
import { TOKEN_EXCHANGE_GRANT_TYPE } from "@/lib/auth/oidc/token-exchange";
import { getAuthIssuer } from "@/lib/auth/oidc/well-known";
import { db } from "@/lib/db/connection";
import { sessions } from "@/lib/db/schema/auth";
import { identityBundles } from "@/lib/db/schema/identity";
import {
  jwks as jwksTable,
  oauthClients,
} from "@/lib/db/schema/oauth-provider";
import { createTestUser, resetDatabase } from "@/test-utils/db-test-utils";
import {
  createTestDpopKeyPair,
  postTokenWithDpop,
} from "@/test-utils/dpop-test-utils";

const ACCESS_TOKEN_TYPE = "urn:ietf:params:oauth:token-type:access_token";
const ID_TOKEN_TYPE = "urn:ietf:params:oauth:token-type:id_token";
const TEST_CLIENT_ID = "exchange-test-agent";
const TOKEN_URL = "http://localhost:3000/api/auth/oauth2/token";
const authIssuer = getAuthIssuer();
const APP_AUDIENCE = "http://localhost:3000";
const CREDENTIAL_AUDIENCE = `${authIssuer}/oidc4vci/credential`;

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

async function createTestClient(
  clientId = TEST_CLIENT_ID,
  metadata?: Record<string, unknown>
) {
  await db
    .insert(oauthClients)
    .values({
      clientId,
      name: "Exchange Test Agent",
      redirectUris: JSON.stringify(["http://localhost/callback"]),
      grantTypes: JSON.stringify([TOKEN_EXCHANGE_GRANT_TYPE]),
      ...(metadata ? { metadata: JSON.stringify(metadata) } : {}),
      tokenEndpointAuthMethod: "none",
      public: true,
    })
    .run();
}

function parseTokenResponse(text: string): Record<string, unknown> {
  const parsedBody = JSON.parse(text) as Record<string, unknown>;
  return "response" in parsedBody
    ? (parsedBody.response as Record<string, unknown>)
    : parsedBody;
}

async function postTokenWithoutDpop(body: Record<string, string>) {
  const response = await auth.handler(
    new Request(TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(body),
    })
  );

  const bodyText = await response.text();
  const json = bodyText ? parseTokenResponse(bodyText) : {};
  return { status: response.status, json };
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
    aud?: string | string[];
    dpopJkt?: string;
    exp?: number;
  } = {}
): Promise<string> {
  const payload: Record<string, unknown> = {
    iss: authIssuer,
    sub,
    aud: opts.aud ?? authIssuer,
    jti: crypto.randomUUID(),
    scope: opts.scope ?? "openid",
    azp: opts.azp ?? TEST_CLIENT_ID,
    iat: Math.floor(Date.now() / 1000),
    exp: opts.exp ?? Math.floor(Date.now() / 1000) + 3600,
    [AUTHENTICATION_CONTEXT_CLAIM]: opts.authContextId ?? defaultAuthContextId,
    ...(opts.aap ?? {}),
    ...(opts.dpopJkt ? { cnf: { jkt: opts.dpopJkt } } : {}),
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

    it("preserves JWT access-token DPoP binding on exchange", async () => {
      const dpopKeyPair = await createTestDpopKeyPair();
      const dpopJkt = await calculateJwkThumbprint(dpopKeyPair.jwk);
      const subjectToken = await mintAccessToken(userId, {
        dpopJkt,
        scope: "openid identity.name",
      });

      const { status, json } = await postTokenWithDpop(
        {
          grant_type: TOKEN_EXCHANGE_GRANT_TYPE,
          client_id: TEST_CLIENT_ID,
          subject_token: subjectToken,
          subject_token_type: ACCESS_TOKEN_TYPE,
          scope: "openid",
        },
        dpopKeyPair
      );

      expect(status).toBe(200);
      const payload = decodeJwt(json.access_token as string);
      expect(payload.cnf).toEqual({ jkt: dpopJkt });
    });

    it("rejects JWT access-token subject when DPoP key differs", async () => {
      const subjectKeyPair = await createTestDpopKeyPair();
      const attackerKeyPair = await createTestDpopKeyPair();
      const subjectToken = await mintAccessToken(userId, {
        dpopJkt: await calculateJwkThumbprint(subjectKeyPair.jwk),
        scope: "openid identity.name",
      });

      const { status, json } = await postTokenWithDpop(
        {
          grant_type: TOKEN_EXCHANGE_GRANT_TYPE,
          client_id: TEST_CLIENT_ID,
          subject_token: subjectToken,
          subject_token_type: ACCESS_TOKEN_TYPE,
          scope: "openid",
        },
        attackerKeyPair
      );

      expect(status).toBe(400);
      expect(json.error).toBe("invalid_grant");
      expect(json.error_description).toBe(
        "Subject token DPoP binding does not match exchange request"
      );
    });

    it("rejects JWT access-token subject when DPoP proof is missing", async () => {
      const dpopKeyPair = await createTestDpopKeyPair();
      const subjectToken = await mintAccessToken(userId, {
        dpopJkt: await calculateJwkThumbprint(dpopKeyPair.jwk),
        scope: "openid identity.name",
      });

      const { status, json } = await postTokenWithoutDpop({
        grant_type: TOKEN_EXCHANGE_GRANT_TYPE,
        client_id: TEST_CLIENT_ID,
        subject_token: subjectToken,
        subject_token_type: ACCESS_TOKEN_TYPE,
        scope: "openid",
      });

      expect(status).toBe(400);
      expect(json.error).toBe("invalid_grant");
      expect(json.error_description).toBe(
        "Subject token DPoP binding does not match exchange request"
      );
    });

    it("allows a resource server to re-bind a DPoP-bound subject token", async () => {
      const resourceServerClientId = "installed-resource-server";
      await createTestClient(resourceServerClientId, {
        zentity_protected_resource: APP_AUDIENCE,
      });

      const callerKeyPair = await createTestDpopKeyPair();
      const resourceServerKeyPair = await createTestDpopKeyPair();
      const subjectToken = await mintAccessToken(userId, {
        aud: APP_AUDIENCE,
        azp: "upstream-client",
        dpopJkt: await calculateJwkThumbprint(callerKeyPair.jwk),
        scope: "openid identity.name",
      });
      const resourceServerJkt = await calculateJwkThumbprint(
        resourceServerKeyPair.jwk
      );

      const { status, json } = await postTokenWithDpop(
        {
          grant_type: TOKEN_EXCHANGE_GRANT_TYPE,
          client_id: resourceServerClientId,
          subject_token: subjectToken,
          subject_token_type: ACCESS_TOKEN_TYPE,
          scope: "openid",
        },
        resourceServerKeyPair
      );

      expect(status).toBe(200);
      const payload = decodeJwt(json.access_token as string);
      expect(payload.cnf).toEqual({ jkt: resourceServerJkt });
      expect(payload.act).toEqual({ sub: resourceServerClientId });
    });

    it("rejects resource-server DPoP re-binding without matching audience", async () => {
      const resourceServerClientId = "installed-resource-server";
      await createTestClient(resourceServerClientId, {
        zentity_protected_resource: APP_AUDIENCE,
      });

      const callerKeyPair = await createTestDpopKeyPair();
      const resourceServerKeyPair = await createTestDpopKeyPair();
      const subjectToken = await mintAccessToken(userId, {
        aud: "https://other-resource.example.com",
        azp: "upstream-client",
        dpopJkt: await calculateJwkThumbprint(callerKeyPair.jwk),
        scope: "openid identity.name",
      });

      const { status, json } = await postTokenWithDpop(
        {
          grant_type: TOKEN_EXCHANGE_GRANT_TYPE,
          client_id: resourceServerClientId,
          subject_token: subjectToken,
          subject_token_type: ACCESS_TOKEN_TYPE,
          scope: "openid",
        },
        resourceServerKeyPair
      );

      expect(status).toBe(400);
      expect(json.error).toBe("invalid_grant");
      expect(json.error_description).toBe(
        "Subject token DPoP binding does not match exchange request"
      );
    });

    it("binds audience to resource parameter", async () => {
      const subjectToken = await mintAccessToken(userId);

      const { status, json } = await postTokenWithDpop({
        grant_type: TOKEN_EXCHANGE_GRANT_TYPE,
        client_id: TEST_CLIENT_ID,
        subject_token: subjectToken,
        subject_token_type: ACCESS_TOKEN_TYPE,
        resource: APP_AUDIENCE,
      });

      expect(status).toBe(200);
      const payload = decodeJwt(json.access_token as string);
      expect(payload.aud).toBe(APP_AUDIENCE);
    });

    it("binds audience to audience parameter when resource is absent", async () => {
      const subjectToken = await mintAccessToken(userId);

      const { status, json } = await postTokenWithDpop({
        grant_type: TOKEN_EXCHANGE_GRANT_TYPE,
        client_id: TEST_CLIENT_ID,
        subject_token: subjectToken,
        subject_token_type: ACCESS_TOKEN_TYPE,
        audience: CREDENTIAL_AUDIENCE,
      });

      expect(status).toBe(200);
      const payload = decodeJwt(json.access_token as string);
      expect(payload.aud).toBe(CREDENTIAL_AUDIENCE);
    });

    it("prefers resource over audience for aud binding", async () => {
      const subjectToken = await mintAccessToken(userId);

      const { status, json } = await postTokenWithDpop({
        grant_type: TOKEN_EXCHANGE_GRANT_TYPE,
        client_id: TEST_CLIENT_ID,
        subject_token: subjectToken,
        subject_token_type: ACCESS_TOKEN_TYPE,
        resource: APP_AUDIENCE,
        audience: CREDENTIAL_AUDIENCE,
      });

      expect(status).toBe(200);
      const payload = decodeJwt(json.access_token as string);
      expect(payload.aud).toBe(APP_AUDIENCE);
    });

    it("rejects unregistered target audiences", async () => {
      const subjectToken = await mintAccessToken(userId);

      const { status, json } = await postTokenWithDpop({
        grant_type: TOKEN_EXCHANGE_GRANT_TYPE,
        client_id: TEST_CLIENT_ID,
        subject_token: subjectToken,
        subject_token_type: ACCESS_TOKEN_TYPE,
        resource: "https://merchant.example.com/api",
      });

      expect(status).toBe(400);
      expect(json.error).toBe("invalid_target");
      expect(json.error_description).toBe(
        "Token exchange target audience is not a registered protected resource"
      );
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
          aap_claims_version: 1,
          act: {
            did: "did:key:z6Mkg3ShJxrz8J4kizVwR6cJQ2s9wZ5x1hQxQds2z7Q9b3Zs",
            host_attestation: "attested",
            host_id: "host-123",
            session_id: "session-123",
            sub: "pairwise-agent-subject",
            type: "mcp-agent",
          },
          task: {
            constraints: [{ field: "merchant", op: "eq", value: "Wine.com" }],
            created_at: 1_700_000_000,
            description: "purchase",
            expires_at: 1_700_003_600,
            hash: "task-hash-123",
          },
          capabilities: [
            {
              action: "purchase",
              constraints: [{ field: "merchant", op: "eq", value: "Wine.com" }],
            },
          ],
          oversight: {
            approval_id: "grant-123",
            approved_at: 1_700_000_000,
            method: "session",
          },
          audit: {
            context_id: "ctx-123",
            release_id: "release-123",
            request_id: "req-123",
          },
          agent_sub: "legacy-agent-subject",
          zentity_context_id: "legacy-context-id",
          zentity_release_id: "legacy-release-id",
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

      expect(payload.act).toEqual(parentPayload.act);
      expect(payload.task).toEqual(parentPayload.task);
      expect(payload.capabilities).toEqual(parentPayload.capabilities);
      expect(payload.oversight).toEqual(parentPayload.oversight);
      expect(payload.audit).toEqual(parentPayload.audit);
      expect(payload.aap_claims_version).toBe(1);
      expect(payload).not.toHaveProperty("agent_sub");
      expect(payload).not.toHaveProperty("zentity_context_id");
      expect(payload).not.toHaveProperty("zentity_release_id");
      expect(payload.delegation).toEqual({
        depth: 1,
        max_depth: 1,
        parent_jti: parentPayload.jti,
      });
    });

    it("rejects second-hop delegation once max_depth is reached", async () => {
      const subjectToken = await mintAccessToken(userId, {
        scope: "openid",
        aap: {
          aap_claims_version: 1,
          act: {
            did: "did:key:z6Mkg3ShJxrz8J4kizVwR6cJQ2s9wZ5x1hQxQds2z7Q9b3Zs",
            host_attestation: "attested",
            host_id: "host-123",
            session_id: "session-123",
            sub: "pairwise-agent-subject",
            type: "mcp-agent",
          },
          task: {
            description: "purchase",
            created_at: 1_700_000_000,
            expires_at: 1_700_003_600,
            hash: "task-hash-123",
          },
          oversight: {
            approval_id: "grant-123",
            approved_at: 1_700_000_000,
            method: "session",
          },
          audit: {
            context_id: "ctx-123",
            release_id: "release-123",
          },
        },
      });

      const firstExchange = await postTokenWithDpop({
        grant_type: TOKEN_EXCHANGE_GRANT_TYPE,
        client_id: TEST_CLIENT_ID,
        subject_token: subjectToken,
        subject_token_type: ACCESS_TOKEN_TYPE,
      });

      expect(firstExchange.status).toBe(200);
      const firstPayload = decodeJwt(firstExchange.json.access_token as string);
      expect(firstPayload.delegation).toEqual({
        depth: 1,
        max_depth: 1,
        parent_jti: expect.any(String),
      });

      const secondExchange = await postTokenWithDpop(
        {
          grant_type: TOKEN_EXCHANGE_GRANT_TYPE,
          client_id: TEST_CLIENT_ID,
          subject_token: firstExchange.json.access_token as string,
          subject_token_type: ACCESS_TOKEN_TYPE,
        },
        firstExchange.dpopKeyPair
      );

      expect(secondExchange.status).toBe(400);
      expect(secondExchange.json.error).toBe("invalid_grant");
      expect(secondExchange.json.error_description).toBe(
        "Subject token exceeded the maximum delegation depth"
      );
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
          validityStatus: "verified",
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

      const firstExchange = await postTokenWithDpop({
        grant_type: TOKEN_EXCHANGE_GRANT_TYPE,
        client_id: agentAId,
        subject_token: originalToken,
        subject_token_type: ACCESS_TOKEN_TYPE,
        scope: "openid identity.name",
      });

      const firstPayload = decodeJwt(firstExchange.json.access_token as string);
      expect(firstPayload.act).toEqual({ sub: agentAId });

      // Second exchange must prove possession of agent A's sender-constrained token.
      const agentBId = "agent-b";
      await createTestClient(agentBId);

      const { status, json: secondExchange } = await postTokenWithDpop(
        {
          grant_type: TOKEN_EXCHANGE_GRANT_TYPE,
          client_id: agentBId,
          subject_token: firstExchange.json.access_token as string,
          subject_token_type: ACCESS_TOKEN_TYPE,
          scope: "openid",
        },
        firstExchange.dpopKeyPair
      );

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

      const pairwiseSub = await resolveSubForClient(userId, {
        subjectType: "pairwise",
        redirectUris: [PAIRWISE_REDIRECT],
      });
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
