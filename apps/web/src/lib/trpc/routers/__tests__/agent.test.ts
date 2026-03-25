import type { Session } from "@/lib/auth/auth";

import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db/connection";
import {
  agentCapabilities,
  agentHostPolicies,
  agentHosts,
  agentSessionGrants,
  agentSessions,
} from "@/lib/db/schema/agent";
import { oauthClients } from "@/lib/db/schema/oauth-provider";
import { capabilityUsageLedger } from "@/lib/db/schema/usage-ledger";
import { createTestUser, resetDatabase } from "@/test/db-test-utils";

const TEST_CLIENT_ID = "agent-router-client";

async function createCaller(userId: string | null) {
  const { agentRouter } = await import("@/lib/trpc/routers/agent");
  const session = userId
    ? ({
        session: { id: `session:${userId}` },
        user: { id: userId },
      } as unknown as Session)
    : null;

  return agentRouter.createCaller({
    flowId: null,
    flowIdSource: "none",
    req: new Request("http://localhost/api/trpc"),
    requestId: "test-request-id",
    resHeaders: new Headers(),
    session,
  });
}

async function createOAuthClient(clientId = TEST_CLIENT_ID) {
  await db
    .insert(oauthClients)
    .values({
      clientId,
      grantTypes: JSON.stringify(["authorization_code"]),
      name: clientId,
      public: true,
      redirectUris: JSON.stringify(["http://localhost/callback"]),
      tokenEndpointAuthMethod: "none",
    })
    .run();
}

async function seedCapabilities() {
  await db
    .insert(agentCapabilities)
    .values([
      {
        approvalStrength: "none",
        description: "Compliance checks",
        name: "check_compliance",
      },
      {
        approvalStrength: "none",
        description: "Safe account summary",
        name: "whoami",
      },
      {
        approvalStrength: "session",
        description: "Profile disclosure",
        name: "my_profile",
      },
      {
        approvalStrength: "none",
        description: "Proof inventory",
        name: "my_proofs",
      },
    ])
    .onConflictDoNothing()
    .run();
}

async function createHost(params: {
  clientId?: string;
  name: string;
  thumbprint: string;
  userId: string;
}) {
  const [host] = await db
    .insert(agentHosts)
    .values({
      clientId: params.clientId ?? TEST_CLIENT_ID,
      name: params.name,
      publicKey: JSON.stringify({
        crv: "Ed25519",
        kty: "OKP",
        x: `${params.thumbprint}-pub`,
      }),
      publicKeyThumbprint: params.thumbprint,
      userId: params.userId,
    })
    .returning({ id: agentHosts.id });

  if (!host) {
    throw new Error("Expected host fixture");
  }

  return host;
}

async function createSession(params: {
  createdAt?: Date;
  displayName: string;
  hostId: string;
  idleTtlSec?: number;
  lastActiveAt?: Date;
  maxLifetimeSec?: number;
  model?: string;
  runtime?: string;
  status?: "active" | "expired" | "revoked";
  thumbprint: string;
  version?: string;
}) {
  const [session] = await db
    .insert(agentSessions)
    .values({
      createdAt: params.createdAt ?? new Date(),
      displayName: params.displayName,
      hostId: params.hostId,
      idleTtlSec: params.idleTtlSec ?? 1800,
      lastActiveAt: params.lastActiveAt ?? new Date(),
      maxLifetimeSec: params.maxLifetimeSec ?? 86_400,
      model: params.model ?? null,
      publicKey: JSON.stringify({
        crv: "Ed25519",
        kty: "OKP",
        x: `${params.thumbprint}-pub`,
      }),
      publicKeyThumbprint: params.thumbprint,
      runtime: params.runtime ?? null,
      status: params.status ?? "active",
      version: params.version ?? null,
    })
    .returning({ id: agentSessions.id });

  if (!session) {
    throw new Error("Expected session fixture");
  }

  return session;
}

async function createGrant(params: {
  capabilityName?: string;
  constraints?: string | null;
  hostPolicyId?: string | null;
  sessionId: string;
  source?: string;
  status?: string;
}) {
  const [grant] = await db
    .insert(agentSessionGrants)
    .values({
      capabilityName: params.capabilityName ?? "check_compliance",
      constraints: params.constraints ?? null,
      hostPolicyId: params.hostPolicyId ?? null,
      sessionId: params.sessionId,
      source: params.source ?? "host_policy",
      status: params.status ?? "active",
    })
    .returning({ id: agentSessionGrants.id });

  if (!grant) {
    throw new Error("Expected grant fixture");
  }

  return grant;
}

describe("agentRouter", () => {
  beforeEach(async () => {
    await resetDatabase();
    await createOAuthClient();
    await seedCapabilities();
  });

  it("lists hosts grouped with effective session lifecycle", async () => {
    const userId = await createTestUser();
    const otherUserId = await createTestUser();
    const caller = await createCaller(userId);

    const host = await createHost({
      name: "Laptop",
      thumbprint: "host-thumbprint-a",
      userId,
    });
    await createHost({
      name: "Other User Host",
      thumbprint: "host-thumbprint-b",
      userId: otherUserId,
    });

    const activeSession = await createSession({
      displayName: "Claude Code",
      hostId: host.id,
      model: "claude",
      runtime: "node",
      thumbprint: "session-active",
      version: "1.0.0",
    });
    const expiredSession = await createSession({
      createdAt: new Date(Date.now() - 7_200_000),
      displayName: "Expired Session",
      hostId: host.id,
      idleTtlSec: 60,
      lastActiveAt: new Date(Date.now() - 7_200_000),
      thumbprint: "session-expired",
    });

    await createGrant({
      constraints: JSON.stringify([
        { field: "merchant", op: "eq", value: "Acme" },
      ]),
      sessionId: activeSession.id,
    });
    await createGrant({
      capabilityName: "my_profile",
      sessionId: expiredSession.id,
      source: "session_elevation",
      status: "pending",
    });

    await db
      .insert(capabilityUsageLedger)
      .values({
        capabilityName: "check_compliance",
        sessionId: activeSession.id,
      })
      .run();

    const hosts = await caller.listHosts();

    expect(hosts).toHaveLength(1);
    expect(hosts[0]?.name).toBe("Laptop");
    expect(hosts[0]?.sessions).toHaveLength(2);
    expect(hosts[0]?.sessions[0]?.id).toBe(activeSession.id);
    expect(
      hosts[0]?.sessions.find((session) => session.id === expiredSession.id)
        ?.status
    ).toBe("expired");
    expect(
      hosts[0]?.sessions.find((session) => session.id === activeSession.id)
        ?.usageToday
    ).toBe(1);

    const persistedExpired = await db
      .select({ status: agentSessions.status })
      .from(agentSessions)
      .where(eq(agentSessions.id, expiredSession.id))
      .limit(1)
      .get();
    expect(persistedExpired?.status).toBe("expired");
  });

  it("returns host detail with durable policies and nested sessions", async () => {
    const userId = await createTestUser();
    const caller = await createCaller(userId);
    const host = await createHost({
      name: "Desktop",
      thumbprint: "host-thumbprint-c",
      userId,
    });
    await createSession({
      displayName: "Runner",
      hostId: host.id,
      thumbprint: "session-detail",
    });

    await db
      .insert(agentHostPolicies)
      .values({
        capabilityName: "check_compliance",
        constraints: JSON.stringify([
          { field: "region", op: "eq", value: "EU" },
        ]),
        hostId: host.id,
        source: "default",
        status: "active",
      })
      .run();

    const detail = await caller.getHostDetail({ hostId: host.id });

    expect(detail?.id).toBe(host.id);
    expect(detail?.policies).toHaveLength(1);
    expect(detail?.sessions).toHaveLength(1);
    expect(detail?.policies[0]?.constraints).toEqual([
      { field: "region", op: "eq", value: "EU" },
    ]);
  });

  it("returns effective lifecycle metadata from getAgentDetail", async () => {
    const userId = await createTestUser();
    const caller = await createCaller(userId);
    const host = await createHost({
      name: "Laptop",
      thumbprint: "host-thumbprint-d",
      userId,
    });
    const session = await createSession({
      createdAt: new Date(Date.now() - 5_400_000),
      displayName: "Aged Runtime",
      hostId: host.id,
      idleTtlSec: 120,
      lastActiveAt: new Date(Date.now() - 5_400_000),
      thumbprint: "session-detail-aged",
    });

    await createGrant({ sessionId: session.id });

    const detail = await caller.getAgentDetail({ sessionId: session.id });

    expect(detail?.status).toBe("expired");
    expect(detail?.lifecycle.status).toBe("expired");
    expect(detail?.idleExpiresAt).toEqual(expect.any(String));
    expect(detail?.maxExpiresAt).toEqual(expect.any(String));
  });

  it("revokes a browser-owned session and cascades grants", async () => {
    const userId = await createTestUser();
    const caller = await createCaller(userId);
    const host = await createHost({
      name: "Laptop",
      thumbprint: "host-thumbprint-e",
      userId,
    });
    const session = await createSession({
      displayName: "Claude Code",
      hostId: host.id,
      thumbprint: "session-revoke",
    });
    const grant = await createGrant({ sessionId: session.id });

    const result = await caller.revokeSession({ sessionId: session.id });

    expect(result).toEqual({ revoked: true });

    const persistedSession = await db
      .select({ status: agentSessions.status })
      .from(agentSessions)
      .where(eq(agentSessions.id, session.id))
      .limit(1)
      .get();
    const persistedGrant = await db
      .select({
        revokedAt: agentSessionGrants.revokedAt,
        status: agentSessionGrants.status,
      })
      .from(agentSessionGrants)
      .where(eq(agentSessionGrants.id, grant.id))
      .limit(1)
      .get();

    expect(persistedSession?.status).toBe("revoked");
    expect(persistedGrant?.status).toBe("revoked");
    expect(persistedGrant?.revokedAt).toBeTruthy();
  });

  it("updates grant constraints while keeping the existing procedure stable", async () => {
    const userId = await createTestUser();
    const caller = await createCaller(userId);
    const host = await createHost({
      name: "Laptop",
      thumbprint: "host-thumbprint-f",
      userId,
    });
    const session = await createSession({
      displayName: "Claude Code",
      hostId: host.id,
      thumbprint: "session-grant-update",
    });
    const grant = await createGrant({ sessionId: session.id });

    const result = await caller.updateGrant({
      constraints: JSON.stringify([
        { field: "amount.value", op: "max", value: 50 },
      ]),
      grantId: grant.id,
    });

    expect(result).toEqual({ updated: true });

    const persistedGrant = await db
      .select({ constraints: agentSessionGrants.constraints })
      .from(agentSessionGrants)
      .where(eq(agentSessionGrants.id, grant.id))
      .limit(1)
      .get();
    expect(persistedGrant?.constraints).toBe(
      JSON.stringify([{ field: "amount.value", op: "max", value: 50 }])
    );
  });
});
