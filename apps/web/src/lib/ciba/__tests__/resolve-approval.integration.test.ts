import crypto from "node:crypto";

import { beforeEach, describe, expect, it } from "vitest";

import { resolveCibaApprovalData } from "@/lib/ciba/resolve-approval";
import { db } from "@/lib/db/connection";
import { agentHosts, agentSessions } from "@/lib/db/schema/agent";
import { cibaRequests } from "@/lib/db/schema/ciba";
import { oauthClients } from "@/lib/db/schema/oauth-provider";
import { createTestUser, resetDatabase } from "@/test/db-test-utils";

const TEST_CLIENT_ID = "resolve-approval-client";

async function createOAuthClient(clientId: string) {
  await db
    .insert(oauthClients)
    .values({
      clientId,
      name: "Test App",
      redirectUris: JSON.stringify(["http://localhost/callback"]),
      grantTypes: JSON.stringify(["urn:openid:params:grant-type:ciba"]),
      tokenEndpointAuthMethod: "none",
      public: true,
    })
    .run();
}

async function createAgentSession(userId: string) {
  const [host] = await db
    .insert(agentHosts)
    .values({
      userId,
      clientId: TEST_CLIENT_ID,
      publicKey: JSON.stringify({ crv: "Ed25519", kty: "OKP", x: "host" }),
      publicKeyThumbprint: `host-${crypto.randomUUID()}`,
      name: "Claude Code Host",
      attestationTier: "attested",
      attestationProvider: "anthropic",
    })
    .returning({ id: agentHosts.id });
  if (!host) {
    throw new Error("Expected host to be created");
  }

  const [session] = await db
    .insert(agentSessions)
    .values({
      hostId: host.id,
      publicKey: JSON.stringify({ crv: "Ed25519", kty: "OKP", x: "agent" }),
      publicKeyThumbprint: `agent-${crypto.randomUUID()}`,
      displayName: "Claude Code",
    })
    .returning({ id: agentSessions.id });
  if (!session) {
    throw new Error("Expected session to be created");
  }

  return session.id;
}

async function insertCibaRequest(
  userId: string,
  overrides: Partial<{
    acrValues: string | null;
    agentSessionId: string | null;
    authReqId: string;
    authorizationDetails: string | null;
    bindingMessage: string | null;
    displayName: string | null;
    model: string | null;
    runtime: string | null;
    scope: string;
    status: string;
  }> = {}
) {
  const authReqId = overrides.authReqId ?? crypto.randomUUID();
  await db
    .insert(cibaRequests)
    .values({
      authReqId,
      clientId: TEST_CLIENT_ID,
      userId,
      scope: overrides.scope ?? "openid",
      status: overrides.status ?? "pending",
      expiresAt: new Date(Date.now() + 300_000),
      agentSessionId: overrides.agentSessionId ?? null,
      displayName: overrides.displayName ?? null,
      model: overrides.model ?? null,
      runtime: overrides.runtime ?? null,
      bindingMessage: overrides.bindingMessage ?? null,
      authorizationDetails: overrides.authorizationDetails ?? null,
      acrValues: overrides.acrValues ?? null,
    })
    .run();
  return authReqId;
}

describe("resolveCibaApprovalData", () => {
  let userId: string;

  beforeEach(async () => {
    await resetDatabase();
    userId = await createTestUser();
    await createOAuthClient(TEST_CLIENT_ID);
  });

  it("returns null for non-existent authReqId", async () => {
    const result = await resolveCibaApprovalData("nonexistent", userId);
    expect(result).toBeNull();
  });

  it("returns null when authReqId belongs to a different user", async () => {
    const authReqId = await insertCibaRequest(userId);
    const otherUserId = await createTestUser({ email: "other@example.com" });
    const result = await resolveCibaApprovalData(authReqId, otherUserId);
    expect(result).toBeNull();
  });

  it("returns correct shape for a basic request without agent", async () => {
    const authReqId = await insertCibaRequest(userId, {
      scope: "openid proof:age",
      bindingMessage: "Approve purchase",
    });

    const result = await resolveCibaApprovalData(authReqId, userId);
    expect(result).not.toBeNull();
    expect(result?.agentIdentity).toBeNull();
    expect(result?.registeredAgent).toBeNull();
    expect(result?.request).toMatchObject({
      auth_req_id: authReqId,
      scope: "openid proof:age",
      status: "pending",
      binding_message: "Approve purchase",
      client_id: TEST_CLIENT_ID,
      client_name: "Test App",
    });
    expect(result?.request.expires_at).toBeDefined();
  });

  it("returns agent identity when displayName is set", async () => {
    const authReqId = await insertCibaRequest(userId, {
      displayName: "Claude Agent",
      model: "claude-opus-4-6",
      runtime: "mcp-node",
    });

    const result = await resolveCibaApprovalData(authReqId, userId);
    expect(result?.agentIdentity).toEqual({
      name: "Claude Agent",
      model: "claude-opus-4-6",
      runtime: "mcp-node",
    });
  });

  it("returns registered agent info when agentSessionId is set", async () => {
    const sessionId = await createAgentSession(userId);
    const authReqId = await insertCibaRequest(userId, {
      agentSessionId: sessionId,
      displayName: "Claude Agent",
    });

    const result = await resolveCibaApprovalData(authReqId, userId);
    expect(result?.registeredAgent).toMatchObject({
      hostName: "Claude Code Host",
      attestationTier: "attested",
      attestationProvider: "anthropic",
      sessionId,
    });
  });

  it("parses authorization_details JSON", async () => {
    const details = [
      {
        type: "purchase",
        item: "Widget",
        amount: { value: "9.99", currency: "USD" },
      },
    ];
    const authReqId = await insertCibaRequest(userId, {
      authorizationDetails: JSON.stringify(details),
    });

    const result = await resolveCibaApprovalData(authReqId, userId);
    expect(result?.request.authorization_details).toEqual(details);
  });

  it("omits optional fields when null in DB", async () => {
    const authReqId = await insertCibaRequest(userId);

    const result = await resolveCibaApprovalData(authReqId, userId);
    expect(result?.request).not.toHaveProperty("binding_message");
    expect(result?.request).not.toHaveProperty("acr_values");
    expect(result?.request).not.toHaveProperty("authorization_details");
  });
});
