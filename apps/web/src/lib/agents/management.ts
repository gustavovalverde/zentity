import "server-only";

import { and, eq, gte, inArray, sql } from "drizzle-orm";

import {
  type EffectiveSessionLifecycle,
  observeSessionLifecycle,
  observeSessionLifecycles,
} from "@/lib/ciba/agent-lifecycle";
import { db } from "@/lib/db/connection";
import {
  agentHostPolicies,
  agentHosts,
  agentSessionGrants,
  agentSessions,
} from "@/lib/db/schema/agent";
import { capabilityUsageLedger } from "@/lib/db/schema/usage-ledger";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

interface BrowserActor {
  kind: "browser_user";
  userId: string;
}

interface DelegatedMachineActor {
  clientId: string;
  kind: "delegated_machine";
  userId: string;
}

type SessionAccessActor = BrowserActor | DelegatedMachineActor;

interface HostRow {
  attestationProvider: string | null;
  attestationTier: string;
  clientId: string;
  createdAt: Date;
  id: string;
  name: string;
  publicKeyThumbprint: string;
  status: string;
  updatedAt: Date;
  userId: string;
}

export interface ManagedSessionGrant {
  capabilityName: string;
  constraints: unknown | null;
  grantedAt: Date | null;
  hostPolicyId: string | null;
  id: string;
  source: string;
  status: string;
}

export interface ManagedSessionSummary {
  createdAt: Date;
  displayName: string;
  grants: ManagedSessionGrant[];
  hostId: string;
  id: string;
  lifecycle: EffectiveSessionLifecycle;
  model: string | null;
  runtime: string | null;
  usageToday: number;
  version: string | null;
}

export interface ManagedHostSummary {
  attestationProvider: string | null;
  attestationTier: string;
  createdAt: Date;
  id: string;
  name: string;
  publicKeyThumbprint: string;
  sessionCount: number;
  sessions: ManagedSessionSummary[];
  status: string;
  updatedAt: Date;
}

export interface ManagedHostPolicy {
  capabilityName: string;
  constraints: unknown | null;
  cooldownSec: number | null;
  createdAt: Date;
  dailyLimitAmount: number | null;
  dailyLimitCount: number | null;
  grantedBy: string | null;
  id: string;
  revokedAt: Date | null;
  source: string;
  status: string;
  updatedAt: Date;
}

export interface ManagedHostDetail extends ManagedHostSummary {
  policies: ManagedHostPolicy[];
}

export interface ManagedSessionDetail {
  attestationProvider: string | null;
  attestationTier: string;
  createdAt: Date;
  grants: Array<
    ManagedSessionGrant & {
      usageToday: {
        count: number;
        totalAmount: number;
      };
    }
  >;
  hostId: string;
  hostName: string;
  hostStatus: string;
  id: string;
  lifecycle: EffectiveSessionLifecycle;
}

interface GrantUpdateInput {
  constraints?: string | null | undefined;
  grantId: string;
  status?: "active" | "denied" | "revoked" | undefined;
}

export class AgentManagementError extends Error {
  readonly code: "conflict" | "forbidden" | "not_found";
  readonly status: number;

  constructor(
    code: "conflict" | "forbidden" | "not_found",
    message: string,
    status: number
  ) {
    super(message);
    this.name = "AgentManagementError";
    this.code = code;
    this.status = status;
  }
}

function parseConstraints(raw: string | null): unknown | null {
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function sortSessions(
  sessions: ManagedSessionSummary[]
): ManagedSessionSummary[] {
  return sessions.toSorted(
    (left, right) =>
      right.lifecycle.lastActiveAt.getTime() -
      left.lifecycle.lastActiveAt.getTime()
  );
}

function assertSessionActorAccess(
  actor: SessionAccessActor,
  session: Pick<HostRow, "clientId" | "userId">
): void {
  if (actor.kind === "browser_user") {
    if (session.userId !== actor.userId) {
      throw new AgentManagementError("forbidden", "Forbidden", 403);
    }
    return;
  }

  if (session.userId !== actor.userId || session.clientId !== actor.clientId) {
    throw new AgentManagementError("forbidden", "Forbidden", 403);
  }
}

async function loadSessionsForHosts(
  hostIds: string[]
): Promise<ManagedSessionSummary[]> {
  if (hostIds.length === 0) {
    return [];
  }

  const sessionRows = await db
    .select({
      createdAt: agentSessions.createdAt,
      displayName: agentSessions.displayName,
      hostId: agentSessions.hostId,
      id: agentSessions.id,
      idleTtlSec: agentSessions.idleTtlSec,
      lastActiveAt: agentSessions.lastActiveAt,
      maxLifetimeSec: agentSessions.maxLifetimeSec,
      model: agentSessions.model,
      runtime: agentSessions.runtime,
      status: agentSessions.status,
      version: agentSessions.version,
    })
    .from(agentSessions)
    .where(inArray(agentSessions.hostId, hostIds))
    .all();

  if (sessionRows.length === 0) {
    return [];
  }

  const lifecycles = await observeSessionLifecycles(sessionRows);
  const sessionIds = sessionRows.map((session) => session.id);
  const dayStart = new Date(Date.now() - ONE_DAY_MS);

  const [grantRows, usageRows] = await Promise.all([
    db
      .select({
        capabilityName: agentSessionGrants.capabilityName,
        constraints: agentSessionGrants.constraints,
        grantedAt: agentSessionGrants.grantedAt,
        hostPolicyId: agentSessionGrants.hostPolicyId,
        id: agentSessionGrants.id,
        sessionId: agentSessionGrants.sessionId,
        source: agentSessionGrants.source,
        status: agentSessionGrants.status,
      })
      .from(agentSessionGrants)
      .where(inArray(agentSessionGrants.sessionId, sessionIds))
      .all(),
    db
      .select({
        count: sql<number>`count(*)`,
        sessionId: capabilityUsageLedger.sessionId,
      })
      .from(capabilityUsageLedger)
      .where(
        and(
          inArray(capabilityUsageLedger.sessionId, sessionIds),
          gte(capabilityUsageLedger.executedAt, dayStart)
        )
      )
      .groupBy(capabilityUsageLedger.sessionId)
      .all(),
  ]);

  const grantMap = new Map<string, ManagedSessionGrant[]>();
  for (const grant of grantRows) {
    const grants = grantMap.get(grant.sessionId) ?? [];
    grants.push({
      capabilityName: grant.capabilityName,
      constraints: parseConstraints(grant.constraints),
      grantedAt: grant.grantedAt,
      hostPolicyId: grant.hostPolicyId,
      id: grant.id,
      source: grant.source,
      status: grant.status,
    });
    grantMap.set(grant.sessionId, grants);
  }

  const usageMap = new Map(usageRows.map((row) => [row.sessionId, row.count]));

  return sessionRows.map((session) => ({
    createdAt: session.createdAt,
    displayName: session.displayName,
    grants:
      grantMap
        .get(session.id)
        ?.toSorted((left, right) =>
          left.capabilityName.localeCompare(right.capabilityName)
        ) ?? [],
    hostId: session.hostId,
    id: session.id,
    lifecycle: lifecycles.get(session.id) ?? {
      createdAt: session.createdAt,
      idleExpiresAt: session.lastActiveAt,
      idleTtlSec: session.idleTtlSec,
      lastActiveAt: session.lastActiveAt,
      maxExpiresAt: session.createdAt,
      maxLifetimeSec: session.maxLifetimeSec,
      status: "revoked",
    },
    model: session.model,
    runtime: session.runtime,
    usageToday: usageMap.get(session.id) ?? 0,
    version: session.version,
  }));
}

async function buildHostSummaries(
  hosts: HostRow[]
): Promise<ManagedHostSummary[]> {
  if (hosts.length === 0) {
    return [];
  }

  const sessions = await loadSessionsForHosts(hosts.map((host) => host.id));
  const sessionsByHostId = new Map<string, ManagedSessionSummary[]>();

  for (const session of sessions) {
    const hostSessions = sessionsByHostId.get(session.hostId) ?? [];
    hostSessions.push(session);
    sessionsByHostId.set(session.hostId, hostSessions);
  }

  return hosts
    .map((host) => {
      const hostSessions = sortSessions(sessionsByHostId.get(host.id) ?? []);
      return {
        attestationProvider: host.attestationProvider,
        attestationTier: host.attestationTier,
        createdAt: host.createdAt,
        id: host.id,
        name: host.name,
        publicKeyThumbprint: host.publicKeyThumbprint,
        sessionCount: hostSessions.length,
        sessions: hostSessions,
        status: host.status,
        updatedAt: host.updatedAt,
      };
    })
    .toSorted((left, right) => {
      const rightLastActive =
        right.sessions[0]?.lifecycle.lastActiveAt.getTime();
      const leftLastActive = left.sessions[0]?.lifecycle.lastActiveAt.getTime();
      return (rightLastActive ?? 0) - (leftLastActive ?? 0);
    });
}

async function loadHostRowForUser(
  userId: string,
  hostId: string
): Promise<HostRow | null> {
  return (
    (await db
      .select({
        attestationProvider: agentHosts.attestationProvider,
        attestationTier: agentHosts.attestationTier,
        clientId: agentHosts.clientId,
        createdAt: agentHosts.createdAt,
        id: agentHosts.id,
        name: agentHosts.name,
        publicKeyThumbprint: agentHosts.publicKeyThumbprint,
        status: agentHosts.status,
        updatedAt: agentHosts.updatedAt,
        userId: agentHosts.userId,
      })
      .from(agentHosts)
      .where(and(eq(agentHosts.id, hostId), eq(agentHosts.userId, userId)))
      .limit(1)
      .get()) ?? null
  );
}

async function loadSessionAccessRow(sessionId: string): Promise<{
  clientId: string;
  hostId: string;
  id: string;
  status: string;
  userId: string;
} | null> {
  const session = await db
    .select({
      clientId: agentHosts.clientId,
      hostId: agentSessions.hostId,
      id: agentSessions.id,
      status: agentSessions.status,
      userId: agentHosts.userId,
    })
    .from(agentSessions)
    .innerJoin(agentHosts, eq(agentSessions.hostId, agentHosts.id))
    .where(eq(agentSessions.id, sessionId))
    .limit(1)
    .get();

  return session ?? null;
}

async function assertGrantOwnedByUser(
  userId: string,
  grantId: string
): Promise<void> {
  const grant = await db
    .select({
      id: agentSessionGrants.id,
      sessionId: agentSessionGrants.sessionId,
    })
    .from(agentSessionGrants)
    .where(eq(agentSessionGrants.id, grantId))
    .limit(1)
    .get();

  if (!grant) {
    throw new AgentManagementError("not_found", "Grant not found", 404);
  }

  const session = await loadSessionAccessRow(grant.sessionId);
  if (!session) {
    throw new AgentManagementError("not_found", "Agent not found", 404);
  }

  assertSessionActorAccess({ kind: "browser_user", userId }, session);
}

export async function listHostsForUser(
  userId: string
): Promise<ManagedHostSummary[]> {
  const hosts = await db
    .select({
      attestationProvider: agentHosts.attestationProvider,
      attestationTier: agentHosts.attestationTier,
      clientId: agentHosts.clientId,
      createdAt: agentHosts.createdAt,
      id: agentHosts.id,
      name: agentHosts.name,
      publicKeyThumbprint: agentHosts.publicKeyThumbprint,
      status: agentHosts.status,
      updatedAt: agentHosts.updatedAt,
      userId: agentHosts.userId,
    })
    .from(agentHosts)
    .where(eq(agentHosts.userId, userId))
    .all();

  return buildHostSummaries(hosts);
}

export async function getHostDetailForUser(
  userId: string,
  hostId: string
): Promise<ManagedHostDetail | null> {
  const host = await loadHostRowForUser(userId, hostId);
  if (!host) {
    return null;
  }

  const [summary, policies] = await Promise.all([
    buildHostSummaries([host]),
    db
      .select({
        capabilityName: agentHostPolicies.capabilityName,
        constraints: agentHostPolicies.constraints,
        cooldownSec: agentHostPolicies.cooldownSec,
        createdAt: agentHostPolicies.createdAt,
        dailyLimitAmount: agentHostPolicies.dailyLimitAmount,
        dailyLimitCount: agentHostPolicies.dailyLimitCount,
        grantedBy: agentHostPolicies.grantedBy,
        id: agentHostPolicies.id,
        revokedAt: agentHostPolicies.revokedAt,
        source: agentHostPolicies.source,
        status: agentHostPolicies.status,
        updatedAt: agentHostPolicies.updatedAt,
      })
      .from(agentHostPolicies)
      .where(eq(agentHostPolicies.hostId, hostId))
      .all(),
  ]);

  const hostSummary = summary[0];
  if (!hostSummary) {
    return null;
  }

  return {
    ...hostSummary,
    policies: policies
      .map((policy) => ({
        capabilityName: policy.capabilityName,
        constraints: parseConstraints(policy.constraints),
        cooldownSec: policy.cooldownSec,
        createdAt: policy.createdAt,
        dailyLimitAmount: policy.dailyLimitAmount,
        dailyLimitCount: policy.dailyLimitCount,
        grantedBy: policy.grantedBy,
        id: policy.id,
        revokedAt: policy.revokedAt,
        source: policy.source,
        status: policy.status,
        updatedAt: policy.updatedAt,
      }))
      .toSorted((left, right) =>
        left.capabilityName.localeCompare(right.capabilityName)
      ),
  };
}

export async function getSessionDetailForUser(
  userId: string,
  sessionId: string
): Promise<ManagedSessionDetail | null> {
  const session = await db
    .select({
      attestationProvider: agentHosts.attestationProvider,
      attestationTier: agentHosts.attestationTier,
      createdAt: agentSessions.createdAt,
      displayName: agentSessions.displayName,
      hostId: agentSessions.hostId,
      hostName: agentHosts.name,
      hostStatus: agentHosts.status,
      id: agentSessions.id,
      idleTtlSec: agentSessions.idleTtlSec,
      lastActiveAt: agentSessions.lastActiveAt,
      maxLifetimeSec: agentSessions.maxLifetimeSec,
      status: agentSessions.status,
      userId: agentHosts.userId,
    })
    .from(agentSessions)
    .innerJoin(agentHosts, eq(agentSessions.hostId, agentHosts.id))
    .where(eq(agentSessions.id, sessionId))
    .limit(1)
    .get();

  if (!session || session.userId !== userId) {
    return null;
  }

  const [lifecycle, grants, usage] = await Promise.all([
    observeSessionLifecycle(sessionId),
    db
      .select({
        capabilityName: agentSessionGrants.capabilityName,
        constraints: agentSessionGrants.constraints,
        grantedAt: agentSessionGrants.grantedAt,
        hostPolicyId: agentSessionGrants.hostPolicyId,
        id: agentSessionGrants.id,
        source: agentSessionGrants.source,
        status: agentSessionGrants.status,
      })
      .from(agentSessionGrants)
      .where(eq(agentSessionGrants.sessionId, sessionId))
      .all(),
    db
      .select({
        capabilityName: capabilityUsageLedger.capabilityName,
        count: sql<number>`count(*)`,
        totalAmount: sql<number>`coalesce(sum(${capabilityUsageLedger.amount}), 0)`,
      })
      .from(capabilityUsageLedger)
      .where(
        and(
          eq(capabilityUsageLedger.sessionId, sessionId),
          gte(
            capabilityUsageLedger.executedAt,
            new Date(Date.now() - ONE_DAY_MS)
          )
        )
      )
      .groupBy(capabilityUsageLedger.capabilityName)
      .all(),
  ]);

  if (!lifecycle) {
    return null;
  }

  const usageByCapability = new Map(
    usage.map((entry) => [
      entry.capabilityName,
      { count: entry.count, totalAmount: entry.totalAmount },
    ])
  );

  return {
    attestationProvider: session.attestationProvider,
    attestationTier: session.attestationTier,
    createdAt: session.createdAt,
    grants: grants
      .map((grant) => ({
        capabilityName: grant.capabilityName,
        constraints: parseConstraints(grant.constraints),
        grantedAt: grant.grantedAt,
        hostPolicyId: grant.hostPolicyId,
        id: grant.id,
        source: grant.source,
        status: grant.status,
        usageToday: usageByCapability.get(grant.capabilityName) ?? {
          count: 0,
          totalAmount: 0,
        },
      }))
      .toSorted((left, right) =>
        left.capabilityName.localeCompare(right.capabilityName)
      ),
    hostId: session.hostId,
    hostName: session.hostName,
    hostStatus: session.hostStatus,
    id: session.id,
    lifecycle,
  };
}

export async function revokeSessionForActor(
  actor: SessionAccessActor,
  sessionId: string
): Promise<{ revoked: true }> {
  const session = await loadSessionAccessRow(sessionId);
  if (!session) {
    throw new AgentManagementError("not_found", "Agent session not found", 404);
  }

  assertSessionActorAccess(actor, session);

  if (session.status === "revoked") {
    throw new AgentManagementError(
      "conflict",
      "Agent session already revoked",
      409
    );
  }

  const now = new Date();

  await db.transaction(async (tx) => {
    await tx
      .update(agentSessions)
      .set({ status: "revoked" })
      .where(eq(agentSessions.id, sessionId));

    await tx
      .update(agentSessionGrants)
      .set({ revokedAt: now, status: "revoked" })
      .where(eq(agentSessionGrants.sessionId, sessionId));
  });

  return { revoked: true };
}

export async function updateGrantForUser(
  userId: string,
  input: GrantUpdateInput
): Promise<{ updated: true }> {
  await assertGrantOwnedByUser(userId, input.grantId);

  const updates: Record<string, Date | string | null> = {};
  if (input.constraints !== undefined) {
    updates.constraints = input.constraints;
  }

  if (input.status) {
    updates.status = input.status;
    if (input.status === "revoked") {
      updates.revokedAt = new Date();
    }
    if (input.status === "active") {
      updates.grantedAt = new Date();
    }
  }

  if (Object.keys(updates).length === 0) {
    return { updated: true };
  }

  await db
    .update(agentSessionGrants)
    .set(updates)
    .where(eq(agentSessionGrants.id, input.grantId));

  return { updated: true };
}
