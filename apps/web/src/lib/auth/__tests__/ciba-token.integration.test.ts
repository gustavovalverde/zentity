import crypto from "node:crypto";

import { decodeJwt } from "jose";
import { beforeEach, describe, expect, it } from "vitest";

import { resolveAgentSubForClient } from "@/lib/ciba/pairwise-agent";
import { db } from "@/lib/db/connection";
import { agentHosts, agentSessions } from "@/lib/db/schema/agent";
import { cibaRequests } from "@/lib/db/schema/ciba";
import { oauthClients } from "@/lib/db/schema/oauth-provider";
import { createTestUser, resetDatabase } from "@/test/db-test-utils";
import { postTokenWithDpop } from "@/test/dpop-test-utils";

const CIBA_GRANT_TYPE = "urn:openid:params:grant-type:ciba";
const TEST_CLIENT_ID = "ciba-test-agent";
// Resource must match a validAudiences entry so the access token is JWT (not opaque)
const TEST_RESOURCE = "http://localhost:3000/api/auth";

async function createTestClient(clientId = TEST_CLIENT_ID) {
  await db
    .insert(oauthClients)
    .values({
      clientId,
      name: "CIBA Test Agent",
      redirectUris: JSON.stringify(["http://localhost/callback"]),
      grantTypes: JSON.stringify([CIBA_GRANT_TYPE]),
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
  await db
    .insert(cibaRequests)
    .values({
      authReqId,
      clientId: TEST_CLIENT_ID,
      userId: overrides.userId ?? "test-user",
      scope: "openid",
      status: "pending",
      expiresAt: new Date(Date.now() + 300_000),
      ...overrides,
    })
    .run();
  return authReqId;
}

describe("CIBA token endpoint", () => {
  let userId: string;

  beforeEach(async () => {
    await resetDatabase();
    userId = await createTestUser();
    await createTestClient();
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

  it("returns tokens for an approved request", async () => {
    const authReqId = await insertCibaRequest({ userId, status: "approved" });

    const { status, json } = await postTokenWithDpop({
      grant_type: CIBA_GRANT_TYPE,
      auth_req_id: authReqId,
      client_id: TEST_CLIENT_ID,
    });

    expect(status).toBe(200);
    expect(json.access_token).toBeDefined();
    expect(typeof json.access_token).toBe("string");
    expect(json.token_type).toBe("DPoP");
    expect(json.expires_in).toBeDefined();
  });

  it("includes act claim in access token JWT", async () => {
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

    const payload = decodeJwt(json.access_token as string);
    expect(payload.act).toEqual({ sub: TEST_CLIENT_ID });
  });

  it("forwards authorization_details to token and response", async () => {
    const authorizationDetails = JSON.stringify([
      {
        type: "purchase",
        merchant: "Test Store",
        item: "Widget",
        amount: { currency: "USD", value: "9.99" },
      },
    ]);
    const authReqId = await insertCibaRequest({
      userId,
      status: "approved",
      resource: TEST_RESOURCE,
      authorizationDetails,
    });

    const { json } = await postTokenWithDpop({
      grant_type: CIBA_GRANT_TYPE,
      auth_req_id: authReqId,
      client_id: TEST_CLIENT_ID,
    });

    // authorization_details in token response body (RFC 9396 §7)
    expect(json.authorization_details).toEqual([
      {
        type: "purchase",
        merchant: "Test Store",
        item: "Widget",
        amount: { currency: "USD", value: "9.99" },
      },
    ]);

    // authorization_details embedded in access token JWT
    const payload = decodeJwt(json.access_token as string);
    expect(payload.authorization_details).toEqual([
      {
        type: "purchase",
        merchant: "Test Store",
        item: "Widget",
        amount: { currency: "USD", value: "9.99" },
      },
    ]);
  });

  it("omits authorization_details when CIBA request has none", async () => {
    const authReqId = await insertCibaRequest({ userId, status: "approved" });

    const { json } = await postTokenWithDpop({
      grant_type: CIBA_GRANT_TYPE,
      auth_req_id: authReqId,
      client_id: TEST_CLIENT_ID,
    });

    expect(json.authorization_details).toBeUndefined();
  });

  it("deletes CIBA request after successful token issuance (replay prevention)", async () => {
    const authReqId = await insertCibaRequest({ userId, status: "approved" });

    // First poll succeeds
    const { status } = await postTokenWithDpop({
      grant_type: CIBA_GRANT_TYPE,
      auth_req_id: authReqId,
      client_id: TEST_CLIENT_ID,
    });
    expect(status).toBe(200);

    // Second poll with same auth_req_id should fail
    const { status: replayStatus, json: replayJson } = await postTokenWithDpop({
      grant_type: CIBA_GRANT_TYPE,
      auth_req_id: authReqId,
      client_id: TEST_CLIENT_ID,
    });
    expect(replayStatus).toBe(400);
    expect(replayJson.error).toBe("invalid_grant");
  });

  it("returns slow_down when polled too frequently", async () => {
    const authReqId = await insertCibaRequest({
      userId,
      status: "pending",
      pollingInterval: 5,
      lastPolledAt: Date.now(),
    });

    const { status, json } = await postTokenWithDpop({
      grant_type: CIBA_GRANT_TYPE,
      auth_req_id: authReqId,
      client_id: TEST_CLIENT_ID,
    });

    expect(status).toBe(400);
    expect(json.error).toBe("slow_down");
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

  it("emits AAP claims for verified registered agent sessions", async () => {
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

    const payload = decodeJwt(json.access_token as string);
    const actorId = await resolveAgentSubForClient(sessionId, TEST_CLIENT_ID);

    expect(payload.agent).toEqual({
      id: actorId,
      type: "mcp-agent",
      model: { id: "gpt-4", version: "1.0.0" },
      runtime: { environment: "test-runner", attested: true },
    });
    expect(payload.act).toEqual({ sub: actorId });
    expect(payload.task).toEqual({
      id: "task-123",
      purpose: "purchase",
    });
    expect(payload.capabilities).toEqual([
      {
        action: "purchase",
        constraints: [{ field: "merchant", op: "eq", value: "Test Store" }],
      },
    ]);
    expect(payload.oversight).toEqual({
      approval_reference: "grant-123",
      requires_human_approval_for: ["purchase"],
    });
    expect(payload.audit).toEqual({
      trace_id: authReqId,
      session_id: actorId,
    });
  });

  it("does not emit AAP claims for plain CIBA requests", async () => {
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

    const payload = decodeJwt(json.access_token as string);
    expect(payload.agent).toBeUndefined();
    expect(payload.task).toBeUndefined();
    expect(payload.capabilities).toBeUndefined();
    expect(payload.oversight).toBeUndefined();
    expect(payload.audit).toBeUndefined();
  });

  it("CIBA access token never contains release_handle", async () => {
    const authReqId = await insertCibaRequest({
      userId,
      status: "approved",
      resource: TEST_RESOURCE,
      scope: "openid identity.name",
    });

    const { json } = await postTokenWithDpop({
      grant_type: CIBA_GRANT_TYPE,
      auth_req_id: authReqId,
      client_id: TEST_CLIENT_ID,
    });

    const payload = decodeJwt(json.access_token as string);
    expect(payload.release_handle).toBeUndefined();
  });
});
