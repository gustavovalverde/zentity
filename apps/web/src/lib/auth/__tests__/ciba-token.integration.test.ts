import crypto from "node:crypto";

import { decodeJwt } from "jose";
import { beforeEach, describe, expect, it } from "vitest";

import { resolveAgentSubForClient } from "@/lib/agents/actor-subject";
import {
  AUTHENTICATION_CONTEXT_CLAIM,
  createAuthenticationContext,
} from "@/lib/auth/authentication-context";
import { loadOpaqueAccessToken } from "@/lib/auth/oidc/haip/opaque-access-token";
import { db } from "@/lib/db/connection";
import { agentHosts, agentSessions } from "@/lib/db/schema/agent";
import { cibaRequests } from "@/lib/db/schema/ciba";
import { oauthClients } from "@/lib/db/schema/oauth-provider";
import { createTestUser, resetDatabase } from "@/test-utils/db-test-utils";
import { postTokenWithDpop } from "@/test-utils/dpop-test-utils";

const CIBA_GRANT_TYPE = "urn:openid:params:grant-type:ciba";
const TEST_CLIENT_ID = "ciba-test-agent";
const TEST_RESOURCE = "http://localhost:3000/api/auth";
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
      public: true,
    })
    .run();
}

async function createRegisteredAgent(userId: string) {
  const [host] = await db
    .insert(agentHosts)
    .values({
      userId,
      clientId: TEST_CLIENT_ID,
      publicKey: JSON.stringify({ crv: "Ed25519", kty: "OKP", x: "host" }),
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
      publicKey: JSON.stringify({ crv: "Ed25519", kty: "OKP", x: "agent" }),
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
      authReqId,
      clientId: TEST_CLIENT_ID,
      userId: overrides.userId ?? "test-user",
      scope: "openid",
      status,
      authContextId:
        overrides.authContextId ??
        (status === "approved" ? defaultAuthContextId : undefined),
      expiresAt: new Date(Date.now() + 300_000),
      ...overrides,
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
  if (accessToken.split(".").length === 3) {
    const payload = decodeJwt(accessToken);
    if (payload.jti !== authReqId) {
      throw new Error(
        `Expected JWT jti ${authReqId}, got ${String(payload.jti)}`
      );
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

  const record = await loadOpaqueAccessToken(accessToken);
  if (!record) {
    throw new Error("Expected opaque access token record to exist");
  }
  if (record.referenceId !== authReqId) {
    throw new Error(
      `Expected opaque token referenceId ${authReqId}, got ${String(record.referenceId)}`
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

  it("returns access_denied for a rejected request", async () => {
    const authReqId = await insertCibaRequest({ userId, status: "rejected" });

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

    expect(status).toBe(200);
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

  it("preserves the access-token binding across refresh-token grants", async () => {
    const authReqId = await insertCibaRequest({
      userId,
      status: "approved",
      resource: TEST_RESOURCE,
      scope: "openid offline_access",
    });

    const initial = await postTokenWithDpop({
      grant_type: CIBA_GRANT_TYPE,
      auth_req_id: authReqId,
      client_id: TEST_CLIENT_ID,
    });

    expect(initial.status).toBe(200);
    expect(typeof initial.json.refresh_token).toBe("string");

    const refreshed = await postTokenWithDpop({
      grant_type: "refresh_token",
      refresh_token: initial.json.refresh_token as string,
      client_id: TEST_CLIENT_ID,
    });

    expect(refreshed.status).toBe(200);

    const tokenShape = await inspectCibaAccessToken(
      refreshed.json.access_token as string,
      authReqId,
      userId
    );
    if (tokenShape.kind === "jwt") {
      expect(tokenShape.payload.aud).toContain(TEST_RESOURCE);
    }
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
        public: true,
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
      resource: TEST_RESOURCE,
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
      const actorId = await resolveAgentSubForClient(sessionId, TEST_CLIENT_ID);
      expect(tokenShape.payload.agent).toEqual({
        id: actorId,
        type: "mcp-agent",
        model: { id: "gpt-4", version: "1.0.0" },
        runtime: { environment: "test-runner", attested: true },
      });
      expect(tokenShape.payload.act).toEqual({ sub: actorId });
    }
  });

  it("does not emit agent claims for plain CIBA requests", async () => {
    const authReqId = await insertCibaRequest({
      userId,
      status: "approved",
      resource: TEST_RESOURCE,
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
      expect(tokenShape.payload.agent).toBeUndefined();
      expect(tokenShape.payload.task).toBeUndefined();
      expect(tokenShape.payload.capabilities).toBeUndefined();
      expect(tokenShape.payload.oversight).toBeUndefined();
      expect(tokenShape.payload.audit).toBeUndefined();
    }
  });
});
