import crypto from "node:crypto";

import { beforeEach, describe, expect, it } from "vitest";

import { resolveSubForClient } from "@/lib/auth/oidc/pairwise";
import {
  resolveAgentSessionIdFromPairwiseSub,
  resolveAgentSubForClient,
} from "@/lib/ciba/pairwise-agent";
import { db } from "@/lib/db/connection";
import { agentHosts, agentSessions } from "@/lib/db/schema/agent";
import { oauthClients } from "@/lib/db/schema/oauth-provider";
import { createTestUser, resetDatabase } from "@/test/db-test-utils";

async function createClient(input: {
  clientId: string;
  metadata?: Record<string, unknown>;
  subjectType: "pairwise" | "public";
}) {
  await db
    .insert(oauthClients)
    .values({
      clientId: input.clientId,
      name: input.clientId,
      redirectUris: JSON.stringify(["https://rp.example.com/callback"]),
      grantTypes: JSON.stringify(["authorization_code"]),
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
      public: true,
      subjectType: input.subjectType,
      tokenEndpointAuthMethod: "none",
    })
    .run();
}

async function createAgentSession(userId: string, clientId: string) {
  const [host] = await db
    .insert(agentHosts)
    .values({
      userId,
      clientId,
      publicKey: JSON.stringify({ crv: "Ed25519", kty: "OKP", x: "host" }),
      publicKeyThumbprint: `host-thumbprint-${crypto.randomUUID()}`,
      name: "Test Host",
    })
    .returning({ id: agentHosts.id });
  if (!host) {
    throw new Error("Expected host fixture");
  }

  const [session] = await db
    .insert(agentSessions)
    .values({
      hostId: host.id,
      publicKey: JSON.stringify({ crv: "Ed25519", kty: "OKP", x: "agent" }),
      publicKeyThumbprint: `agent-thumbprint-${crypto.randomUUID()}`,
      displayName: "Test Agent",
    })
    .returning({ id: agentSessions.id });
  if (!session) {
    throw new Error("Expected session fixture");
  }

  return session.id;
}

describe("pairwise agent identifiers", () => {
  let userId: string;

  beforeEach(async () => {
    await resetDatabase();
    userId = await createTestUser();
  });

  it("supports pairwise users with public agent identifiers", async () => {
    const clientId = "pairwise-user-public-agent";
    await createClient({
      clientId,
      metadata: { agent_subject_type: "public" },
      subjectType: "pairwise",
    });
    const sessionId = await createAgentSession(userId, clientId);

    const userSub = await resolveSubForClient(userId, {
      redirectUris: ["https://rp.example.com/callback"],
      subjectType: "pairwise",
    });
    const agentSub = await resolveAgentSubForClient(sessionId, clientId);

    expect(userSub).not.toBe(userId);
    expect(agentSub).toBe(sessionId);
    expect(await resolveAgentSessionIdFromPairwiseSub(agentSub, clientId)).toBe(
      sessionId
    );
  });

  it("supports public users with pairwise agent identifiers", async () => {
    const clientId = "public-user-pairwise-agent";
    await createClient({
      clientId,
      metadata: { agent_subject_type: "pairwise" },
      subjectType: "public",
    });
    const sessionId = await createAgentSession(userId, clientId);

    const userSub = await resolveSubForClient(userId, {
      redirectUris: ["https://rp.example.com/callback"],
      subjectType: "public",
    });
    const agentSub = await resolveAgentSubForClient(sessionId, clientId);

    expect(userSub).toBe(userId);
    expect(agentSub).not.toBe(sessionId);
    expect(await resolveAgentSessionIdFromPairwiseSub(agentSub, clientId)).toBe(
      sessionId
    );
  });
});
