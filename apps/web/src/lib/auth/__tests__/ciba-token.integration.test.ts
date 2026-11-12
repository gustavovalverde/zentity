import crypto from "node:crypto";

import { encodeEd25519DidKeyFromJwk } from "@zentity/sdk/protocol";
import { decodeJwt } from "jose";
import { beforeEach, describe, expect, it } from "vitest";

import { resolveAgentSubForClient } from "@/lib/agents/actor-subject";
import {
  AUTHENTICATION_CONTEXT_CLAIM,
  createAuthenticationContext,
} from "@/lib/auth/auth-context";
import { db } from "@/lib/db/connection";
import { agentHosts, agentSessions } from "@/lib/db/schema/agent";
import { cibaRequests } from "@/lib/db/schema/ciba";
import { oauthClients } from "@/lib/db/schema/oauth-provider";
import {
  createTestUser,
  findStoredOpaqueAccessToken,
  hashCibaAuthReqId,
  resetDatabase,
} from "@/test-utils/db-test-utils";
import { postTokenWithDpop } from "@/test-utils/dpop-test-utils";

const CIBA_GRANT_TYPE = "urn:openid:params:grant-type:ciba";
const TEST_CLIENT_ID = "ciba-test-agent";
const TEST_RESOURCE = "http://localhost:3000/api/auth";
const HOST_DID = encodeEd25519DidKeyFromJwk({
  crv: "Ed25519",
  kty: "OKP",
  x: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
});
let defaultAuthContextId: string;

async function createTestClient(clientId = TEST_CLIENT_ID) {
  await db
    .insert(oauthClients)
    .values({
      clientId,
      name: "CIBA Test Agent",
      redirectUris: JSON.stringify(["http://localhost/callback"]),
      grantTypes: JSON.stringify([CIBA_GRANT_TYPE, "refresh_token"]),
      tokenEndpointAuthMethod: "none",
    })
    .run();
}

async function createRegisteredAgent(userId: string) {
  const [host] = await db
    .insert(agentHosts)
    .values({
      userId,
      clientId: TEST_CLIENT_ID,
      publicKey: JSON.stringify({
        crv: "Ed25519",
        kty: "OKP",
        x: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      }),
      publicKeyThumbprint: `host-thumbprint-${crypto.randomUUID()}`,
      name: "Test Host",
      attestationProvider: "AgentPass",
      attestationTier: "attested",
    })
    .returning({ id: agentHosts.id });
  if (!host) {
    throw new Error("Expected registered host fixture to be created");
  }

  const [session] = await db
    .insert(agentSessions)
    .values({
      hostId: host.id,
      publicKey: JSON.stringify({
        crv: "Ed25519",
        kty: "OKP",
        x: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE",
      }),
      publicKeyThumbprint: `agent-thumbprint-${crypto.randomUUID()}`,
      displayName: "Test Agent",
      runtime: "test-runner",
      model: "gpt-4",
      version: "1.0.0",
    })
    .returning({ id: agentSessions.id });

  if (!session) {
    throw new Error("Expected registered session fixture to be created");
  }

  return { hostId: host.id, sessionId: session.id };
}

async function insertCibaRequest(
  overrides: Partial<typeof cibaRequests.$inferInsert> = {}
) {
  const authReqId = overrides.authReqId ?? crypto.randomUUID();
  const status = overrides.status ?? "pending";
  await db
    .insert(cibaRequests)
    .values({
      clientId: TEST_CLIENT_ID,
      userId: overrides.userId ?? "test-user",
      scope: "openid",
      status,
      authContextId:
        overrides.authContextId ??
        (status === "approved" ? defaultAuthContextId : undefined),
      expiresAt: new Date(Date.now() + 300_000),
      // A Zentity approval makes the request reference its own hash.
      ...(status === "approved"
        ? { referenceId: hashCibaAuthReqId(authReqId) }
        : {}),
      ...overrides,
      // The CIBA plugin stores the hash of auth_req_id at rest; callers get the
      // raw value to send to the token endpoint, which hashes for lookup.
      authReqId: hashCibaAuthReqId(authReqId),
    })
    .run();
  return authReqId;
}

async function inspectCibaAccessToken(
  accessToken: string,
  authReqId: string,
  userId: string,
  authContextId?: string
) {
  const expectedReference = hashCibaAuthReqId(authReqId);
  if (accessToken.split(".").length === 3) {
    const payload = decodeJwt(accessToken);
    // The AS owns the JWT jti (RFC 9068, unique-random); it is not bound to the
    // auth_req_id. CIBA correlation lives in audit.ciba_request_id (the hash).
    if (typeof payload.jti !== "string" || payload.jti.length === 0) {
      throw new Error("Expected JWT access token to carry a jti");
    }
    if (
      authContextId &&
      payload[AUTHENTICATION_CONTEXT_CLAIM] !== authContextId
    ) {
      throw new Error(
        `Expected JWT auth context ${authContextId}, got ${String(payload[AUTHENTICATION_CONTEXT_CLAIM])}`
      );
    }
    return { kind: "jwt" as const, payload };
  }

  const record = await findStoredOpaqueAccessToken(accessToken);
  if (!record) {
    throw new Error("Expected opaque access token record to exist");
  }
  if (record.referenceId !== expectedReference) {
    throw new Error(
      `Expected opaque token referenceId ${expectedReference}, got ${String(record.referenceId)}`
    );
  }
  if (record.userId !== userId) {
    throw new Error(
      `Expected opaque token userId ${userId}, got ${String(record.userId)}`
    );
  }
  if (authContextId && record.authContextId !== authContextId) {
    throw new Error(
      `Expected opaque token auth context ${authContextId}, got ${String(record.authContextId)}`
    );
  }
  return { kind: "opaque" as const, record };
}

describe("CIBA token endpoint", () => {
  let userId: string;

  beforeEach(async () => {
    await resetDatabase();
    userId = await createTestUser();
    await createTestClient();
    defaultAuthContextId = (
      await createAuthenticationContext({
        userId,
        loginMethod: "passkey",
        authenticatedAt: new Date(),
        sourceKind: "ciba_approval",
        referenceType: "ciba_request",
      })
    ).id;
  });

  it("returns authorization_pending for a pending request", async () => {
    const authReqId = await insertCibaRequest({ userId, status: "pending" });

    const { status, json } = await postTokenWithDpop({
      grant_type: CIBA_GRANT_TYPE,
      auth_req_id: authReqId,
      client_id: TEST_CLIENT_ID,
    });

    expect(status).toBe(400);
    expect(json.error).toBe("authorization_pending");
  });

  it("returns access_denied for a denied request", async () => {
    const authReqId = await insertCibaRequest({ userId, status: "denied" });

    const { status, json } = await postTokenWithDpop({
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

    const { status, json } = await postTokenWithDpop({
      grant_type: CIBA_GRANT_TYPE,
      auth_req_id: authReqId,
      client_id: TEST_CLIENT_ID,
    });

    expect(status).toBe(400);
    expect(json.error).toBe("expired_token");
  });

  it("returns a token bound to the approved CIBA request", async () => {
    const authReqId = await insertCibaRequest({ userId, status: "approved" });

    const { status, json } = await postTokenWithDpop({
      grant_type: CIBA_GRANT_TYPE,
      auth_req_id: authReqId,
      client_id: TEST_CLIENT_ID,
    });

    expect({ status, json }).toMatchObject({ status: 200 });
    expect(typeof json.access_token).toBe("string");
    expect(json.token_type).toBe("DPoP");
    expect(json.expires_in).toBeDefined();

    await inspectCibaAccessToken(
      json.access_token as string,
      authReqId,
      userId,
      defaultAuthContextId
    );
  });

  it("issues no refresh token, because the token names its actor", async () => {
    const authReqId = await insertCibaRequest({
      userId,
      status: "approved",
      resources: JSON.stringify([TEST_RESOURCE]),
      scope: "openid offline_access",
    });

    const { status, json } = await postTokenWithDpop({
      grant_type: CIBA_GRANT_TYPE,
      auth_req_id: authReqId,
      client_id: TEST_CLIENT_ID,
    });

    expect(status).toBe(200);
    expect(json).not.toHaveProperty("refresh_token");
  });

  it("deletes CIBA request after successful token issuance (replay prevention)", async () => {
    const authReqId = await insertCibaRequest({ userId, status: "approved" });

    const { status } = await postTokenWithDpop({
      grant_type: CIBA_GRANT_TYPE,
      auth_req_id: authReqId,
      client_id: TEST_CLIENT_ID,
    });
    expect(status).toBe(200);

    const { status: replayStatus, json: replayJson } = await postTokenWithDpop({
      grant_type: CIBA_GRANT_TYPE,
      auth_req_id: authReqId,
      client_id: TEST_CLIENT_ID,
    });
    expect(replayStatus).toBe(400);
    expect(replayJson.error).toBe("invalid_grant");
  });

  it("rejects when client_id does not match CIBA request", async () => {
    await db
      .insert(oauthClients)
      .values({
        clientId: "other-agent",
        name: "Other Agent",
        redirectUris: JSON.stringify(["http://localhost/callback"]),
        grantTypes: JSON.stringify([CIBA_GRANT_TYPE]),
        tokenEndpointAuthMethod: "none",
      })
      .run();

    const authReqId = await insertCibaRequest({ userId, status: "approved" });

    const { status, json } = await postTokenWithDpop({
      grant_type: CIBA_GRANT_TYPE,
      auth_req_id: authReqId,
      client_id: "other-agent",
    });

    expect(status).toBe(400);
    expect(json.error).toBe("invalid_grant");
  });

  it("binds verified agent sessions into the access-token record", async () => {
    const { hostId, sessionId } = await createRegisteredAgent(userId);
    const authReqId = await insertCibaRequest({
      userId,
      status: "approved",
      resources: JSON.stringify([TEST_RESOURCE]),
      hostId,
      agentSessionId: sessionId,
      displayName: "Test Agent",
      model: "gpt-4",
      runtime: "test-runner",
      version: "1.0.0",
      taskId: "task-123",
      assertionVerified: true,
      approvedCapabilityName: "purchase",
      approvedConstraints: JSON.stringify([
        { field: "merchant", op: "eq", value: "Test Store" },
      ]),
      approvedGrantId: "grant-123",
      approvalStrength: "session",
      attestationProvider: "AgentPass",
      attestationTier: "attested",
    });

    const { json } = await postTokenWithDpop({
      grant_type: CIBA_GRANT_TYPE,
      auth_req_id: authReqId,
      client_id: TEST_CLIENT_ID,
    });

    const tokenShape = await inspectCibaAccessToken(
      json.access_token as string,
      authReqId,
      userId,
      defaultAuthContextId
    );
    if (tokenShape.kind === "jwt") {
      expect(tokenShape.payload).not.toHaveProperty("agent_sub");
      expect(tokenShape.payload).not.toHaveProperty("zentity_context_id");
      expect(tokenShape.payload).not.toHaveProperty("zentity_release_id");
      const actorId = await resolveAgentSubForClient(sessionId, TEST_CLIENT_ID);
      expect(tokenShape.payload.act).toEqual({
        did: HOST_DID,
        host_attestation: "attested",
        host_id: hostId,
        session_id: sessionId,
        sub: actorId,
        type: "mcp-agent",
      });
      expect(tokenShape.payload.task).toEqual({
        constraints: [{ field: "merchant", op: "eq", value: "Test Store" }],
        created_at: expect.any(Number),
        description: "purchase",
        expires_at: expect.any(Number),
        hash: expect.any(String),
      });
      expect(tokenShape.payload.capabilities).toEqual([
        {
          action: "purchase",
          constraints: [{ field: "merchant", op: "eq", value: "Test Store" }],
        },
      ]);
      expect(tokenShape.payload.oversight).toEqual({
        approval_id: "grant-123",
        approved_at: expect.any(Number),
        method: "session",
      });
      // auth_req_id is hashed at rest (it is a bearer credential); the audit
      // correlation claim carries the hash, never the raw value.
      const authReqIdHash = hashCibaAuthReqId(authReqId);
      expect(tokenShape.payload.audit).toEqual({
        ciba_request_id: authReqIdHash,
        context_id: defaultAuthContextId,
        release_id: "dev",
        request_id: authReqIdHash,
      });
      expect(tokenShape.payload.delegation).toEqual({
        depth: 0,
        max_depth: 1,
        parent_jti: null,
      });
      expect(tokenShape.payload.aap_claims_version).toBe(1);
    }
  });

  it("does not emit agent claims for plain CIBA requests", async () => {
    const authReqId = await insertCibaRequest({
      userId,
      status: "approved",
      resources: JSON.stringify([TEST_RESOURCE]),
    });

    const { json } = await postTokenWithDpop({
      grant_type: CIBA_GRANT_TYPE,
      auth_req_id: authReqId,
      client_id: TEST_CLIENT_ID,
    });

    const tokenShape = await inspectCibaAccessToken(
      json.access_token as string,
      authReqId,
      userId,
      defaultAuthContextId
    );
    if (tokenShape.kind === "jwt") {
      expect(tokenShape.payload).not.toHaveProperty("agent_sub");
      expect(tokenShape.payload).not.toHaveProperty("zentity_context_id");
      expect(tokenShape.payload).not.toHaveProperty("zentity_release_id");
      expect(tokenShape.payload.act).toEqual({ sub: TEST_CLIENT_ID });
      expect(tokenShape.payload.task).toBeUndefined();
      expect(tokenShape.payload.capabilities).toBeUndefined();
      expect(tokenShape.payload.oversight).toBeUndefined();
      expect(tokenShape.payload.audit).toBeUndefined();
      expect(tokenShape.payload.delegation).toBeUndefined();
    }
  });

  it("stores the actor on an opaque CIBA token for introspection", async () => {
    const authReqId = await insertCibaRequest({ userId, status: "approved" });

    const { json } = await postTokenWithDpop({
      grant_type: CIBA_GRANT_TYPE,
      auth_req_id: authReqId,
      client_id: TEST_CLIENT_ID,
    });

    const tokenShape = await inspectCibaAccessToken(
      json.access_token as string,
      authReqId,
      userId
    );
    expect(tokenShape.kind).toBe("opaque");
    if (tokenShape.kind === "opaque") {
      expect(tokenShape.record.act).toEqual({
        sub: TEST_CLIENT_ID,
      });
    }
  });
});
