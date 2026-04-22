import type { Client } from "@libsql/client";

import crypto from "node:crypto";

import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  resolveAgentSessionIdFromPairwiseSub,
  resolveAgentSubForClient,
} from "@/lib/agents/actor-subject";
import { revokeSessionForActor } from "@/lib/agents/management";
import { resolveSubForClient } from "@/lib/auth/oidc/pairwise";
import { db } from "@/lib/db/connection";
import { agentHosts, agentSessions } from "@/lib/db/schema/agent";
import { oauthClients, pairwiseSubjects } from "@/lib/db/schema/oauth-provider";
import { createTestUser, resetDatabase } from "@/test-utils/db-test-utils";

function getDbClient() {
  return db as typeof db & { $client: Pick<Client, "execute"> };
}

async function countDatabaseQueries(run: () => Promise<void>): Promise<number> {
  const client = getDbClient();
  const executeSpy = vi.spyOn(client.$client, "execute");

  try {
    await run();
    return executeSpy.mock.calls.length;
  } finally {
    executeSpy.mockRestore();
  }
}

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
      publicKey: JSON.stringify({
        crv: "Ed25519",
        kty: "OKP",
        x: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      }),
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
      publicKey: JSON.stringify({
        crv: "Ed25519",
        kty: "OKP",
        x: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE",
      }),
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

  it("uses a constant query count once pairwise agent rows are indexed", async () => {
    const clientId = "pairwise-agent-indexed";
    await createClient({
      clientId,
      metadata: { agent_subject_type: "pairwise" },
      subjectType: "public",
    });
    const sessionId = await createAgentSession(userId, clientId);

    const indexedSub = await resolveAgentSubForClient(sessionId, clientId);

    const queryCountWithOneSession = await countDatabaseQueries(async () => {
      await expect(
        resolveAgentSessionIdFromPairwiseSub(indexedSub, clientId)
      ).resolves.toBe(sessionId);
    });

    for (let index = 0; index < 20; index += 1) {
      await createAgentSession(userId, clientId);
    }

    const queryCountWithManySessions = await countDatabaseQueries(async () => {
      await expect(
        resolveAgentSessionIdFromPairwiseSub(indexedSub, clientId)
      ).resolves.toBe(sessionId);
    });

    expect(queryCountWithManySessions).toBe(queryCountWithOneSession);
  });

  it("removes indexed pairwise agent rows when a session is revoked", async () => {
    const clientId = "pairwise-agent-revoke";
    await createClient({
      clientId,
      metadata: { agent_subject_type: "pairwise" },
      subjectType: "public",
    });
    const sessionId = await createAgentSession(userId, clientId);
    const pairwiseSub = await resolveAgentSubForClient(sessionId, clientId);

    const indexedBefore = await db
      .select({ subjectId: pairwiseSubjects.subjectId })
      .from(pairwiseSubjects)
      .where(eq(pairwiseSubjects.subjectId, sessionId))
      .all();
    expect(indexedBefore).toHaveLength(1);

    await revokeSessionForActor({ kind: "browser_user", userId }, sessionId);

    const indexedAfter = await db
      .select({ subjectId: pairwiseSubjects.subjectId })
      .from(pairwiseSubjects)
      .where(eq(pairwiseSubjects.subjectId, sessionId))
      .all();
    expect(indexedAfter).toHaveLength(0);

    await expect(
      resolveAgentSessionIdFromPairwiseSub(pairwiseSub, clientId)
    ).resolves.toBeNull();
  });
});
