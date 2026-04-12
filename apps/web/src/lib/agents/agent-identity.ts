import { eq, inArray, lt } from "drizzle-orm";
import { importJWK, jwtVerify } from "jose";

import {
  type AuthorizationDetail,
  deriveCapabilityName,
  resolveCapabilityApprovalStrength,
} from "@/lib/agents/approval-engine";
import { resolveAgentSubForClient } from "@/lib/agents/pairwise-agent";
import { db } from "@/lib/db/connection";
import {
  agentHosts,
  agentSessions,
  usedAgentAssertionJtis,
} from "@/lib/db/schema/agent";
import { cibaRequests } from "@/lib/db/schema/ciba";

// ---------------------------------------------------------------------------
// Session lifecycle (idle TTL + max lifetime → active|expired|revoked)
// ---------------------------------------------------------------------------

export type SessionLifecycleStatus = "active" | "expired" | "revoked";

interface SessionLifecycleSource {
  createdAt: Date;
  id: string;
  idleTtlSec: number;
  lastActiveAt: Date;
  maxLifetimeSec: number;
  status: string;
}

export interface EffectiveSessionLifecycle {
  createdAt: Date;
  idleExpiresAt: Date;
  idleTtlSec: number;
  lastActiveAt: Date;
  maxExpiresAt: Date;
  maxLifetimeSec: number;
  status: SessionLifecycleStatus;
}

function resolveSessionLifecycle(
  session: Omit<SessionLifecycleSource, "id">,
  now = new Date()
): EffectiveSessionLifecycle {
  const idleExpiresAt = new Date(
    session.lastActiveAt.getTime() + session.idleTtlSec * 1000
  );
  const maxExpiresAt = new Date(
    session.createdAt.getTime() + session.maxLifetimeSec * 1000
  );
  const persistedStatus = session.status as SessionLifecycleStatus;

  let status: SessionLifecycleStatus = persistedStatus;
  if (persistedStatus !== "revoked" && persistedStatus !== "expired") {
    status = now >= idleExpiresAt || now >= maxExpiresAt ? "expired" : "active";
  }

  return {
    createdAt: session.createdAt,
    idleExpiresAt,
    idleTtlSec: session.idleTtlSec,
    lastActiveAt: session.lastActiveAt,
    maxExpiresAt,
    maxLifetimeSec: session.maxLifetimeSec,
    status,
  };
}

async function persistExpiredSessions(sessionIds: string[]): Promise<void> {
  if (sessionIds.length === 0) {
    return;
  }
  await db
    .update(agentSessions)
    .set({ status: "expired" })
    .where(inArray(agentSessions.id, sessionIds));
}

export async function observeSessionLifecycles(
  sessions: SessionLifecycleSource[]
): Promise<Map<string, EffectiveSessionLifecycle>> {
  if (sessions.length === 0) {
    return new Map();
  }

  const now = new Date();
  const lifecycleEntries = sessions.map((session) => {
    const lifecycle = resolveSessionLifecycle(session, now);
    return { lifecycle, session };
  });

  const expiredSessionIds = lifecycleEntries
    .filter(
      ({ lifecycle, session }) =>
        lifecycle.status === "expired" && session.status !== "expired"
    )
    .map(({ session }) => session.id);

  await persistExpiredSessions(expiredSessionIds);

  return new Map(
    lifecycleEntries.map(({ lifecycle, session }) => [session.id, lifecycle])
  );
}

export async function observeSessionLifecycle(
  sessionId: string
): Promise<EffectiveSessionLifecycle | null> {
  const session = await db
    .select({
      createdAt: agentSessions.createdAt,
      idleTtlSec: agentSessions.idleTtlSec,
      id: agentSessions.id,
      lastActiveAt: agentSessions.lastActiveAt,
      maxLifetimeSec: agentSessions.maxLifetimeSec,
      status: agentSessions.status,
    })
    .from(agentSessions)
    .where(eq(agentSessions.id, sessionId))
    .limit(1)
    .get();

  if (!session) {
    return null;
  }

  const lifecycles = await observeSessionLifecycles([session]);
  return lifecycles.get(sessionId) ?? null;
}

export async function computeSessionState(
  sessionId: string
): Promise<SessionLifecycleStatus> {
  const lifecycle = await observeSessionLifecycle(sessionId);
  if (!lifecycle) {
    return "revoked";
  }
  return lifecycle.status;
}

// ---------------------------------------------------------------------------
// Agent-Assertion JWT verification (Ed25519, issued by agent_session)
// ---------------------------------------------------------------------------

interface AgentAssertionResult {
  exp: number;
  hostId: string;
  jti: string;
  sessionId: string;
  taskDescriptionHash?: string | undefined;
  taskId?: string | undefined;
}

function agentAssertionReplayKey(sessionId: string, jti: string): string {
  return `${sessionId}:${jti}`;
}

async function cleanupExpiredAgentAssertionJtis(): Promise<void> {
  try {
    await db
      .delete(usedAgentAssertionJtis)
      .where(lt(usedAgentAssertionJtis.expiresAt, new Date()))
      .run();
  } catch {
    // Non-critical — stale rows are harmless.
  }
}

async function verifyAgentAssertion(
  jwt: string
): Promise<AgentAssertionResult | null> {
  try {
    const payloadB64 = jwt.split(".")[1];
    if (!payloadB64) {
      return null;
    }

    const rawPayload = JSON.parse(
      Buffer.from(payloadB64, "base64url").toString("utf-8")
    ) as { iss?: string };
    const sessionId = rawPayload.iss;
    if (!sessionId) {
      return null;
    }

    const session = await db
      .select({
        publicKey: agentSessions.publicKey,
        status: agentSessions.status,
      })
      .from(agentSessions)
      .where(eq(agentSessions.id, sessionId))
      .limit(1)
      .get();
    if (!session || session.status !== "active") {
      return null;
    }

    const publicKey = await importJWK(JSON.parse(session.publicKey), "EdDSA");
    const { payload, protectedHeader } = await jwtVerify(jwt, publicKey, {
      algorithms: ["EdDSA"],
      issuer: sessionId,
    });
    if (protectedHeader.typ !== "agent-assertion+jwt") {
      return null;
    }

    const lifecycle = await computeSessionState(sessionId);
    if (lifecycle !== "active") {
      return null;
    }

    const jti = payload.jti;
    const exp = payload.exp;
    if (typeof jti !== "string" || typeof exp !== "number") {
      return null;
    }

    return {
      exp,
      sessionId,
      hostId: (payload.host_id as string) ?? "",
      jti,
      taskId: payload.task_id as string | undefined,
      taskDescriptionHash: payload.task_hash as string | undefined,
    };
  } catch {
    return null;
  }
}

async function sha256Hex(input: string): Promise<string> {
  const encoded = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

// ---------------------------------------------------------------------------
// Binding a verified assertion to a CIBA request
// ---------------------------------------------------------------------------

interface BoundAgentAssertion {
  agentName: string;
  approvalStrength?: string | undefined;
  capabilityName: string | null;
  registeredAgent: {
    attestationProvider?: string | null;
    attestationTier?: string | null;
    model?: string | null;
    name: string;
    runtime?: string | null;
    version?: string | null;
  };
  sessionId: string;
}

interface BindAgentAssertionParams {
  assertionJwt: string;
  authorizationDetails: AuthorizationDetail[];
  authReqId: string;
  scope: string;
}

export async function bindAgentAssertionToCibaRequest(
  params: BindAgentAssertionParams
): Promise<BoundAgentAssertion | null> {
  const cibaRow = await db
    .select({
      bindingMessage: cibaRequests.bindingMessage,
      clientId: cibaRequests.clientId,
      userId: cibaRequests.userId,
    })
    .from(cibaRequests)
    .where(eq(cibaRequests.authReqId, params.authReqId))
    .limit(1)
    .get();
  if (!cibaRow?.bindingMessage) {
    return null;
  }

  const assertion = await verifyAgentAssertion(params.assertionJwt);
  if (!(assertion?.taskDescriptionHash && assertion.hostId)) {
    return null;
  }

  const expectedTaskHash = await sha256Hex(cibaRow.bindingMessage);
  if (expectedTaskHash !== assertion.taskDescriptionHash) {
    return null;
  }

  const session = await db
    .select({
      displayName: agentSessions.displayName,
      hostId: agentSessions.hostId,
      id: agentSessions.id,
      model: agentSessions.model,
      runtime: agentSessions.runtime,
      version: agentSessions.version,
    })
    .from(agentSessions)
    .where(eq(agentSessions.id, assertion.sessionId))
    .limit(1)
    .get();
  if (!session || session.hostId !== assertion.hostId) {
    return null;
  }

  const host = await db
    .select({
      attestationProvider: agentHosts.attestationProvider,
      attestationTier: agentHosts.attestationTier,
      clientId: agentHosts.clientId,
      id: agentHosts.id,
      userId: agentHosts.userId,
    })
    .from(agentHosts)
    .where(eq(agentHosts.id, session.hostId))
    .limit(1)
    .get();
  if (
    !host ||
    host.id !== assertion.hostId ||
    host.userId !== cibaRow.userId ||
    host.clientId !== cibaRow.clientId
  ) {
    return null;
  }

  const capabilityName = deriveCapabilityName(
    params.authorizationDetails,
    params.scope
  );
  const approvalStrength =
    await resolveCapabilityApprovalStrength(capabilityName);
  const pairwiseActSub = await resolveAgentSubForClient(
    session.id,
    cibaRow.clientId
  );

  await cleanupExpiredAgentAssertionJtis();

  let bound = false;
  await db.transaction(async (tx) => {
    const replayInsert = await tx
      .insert(usedAgentAssertionJtis)
      .values({
        id: agentAssertionReplayKey(assertion.sessionId, assertion.jti),
        sessionId: assertion.sessionId,
        jti: assertion.jti,
        expiresAt: new Date(assertion.exp * 1000),
      })
      .onConflictDoNothing()
      .run();
    if (replayInsert.rowsAffected === 0) {
      return;
    }

    await tx
      .update(cibaRequests)
      .set({
        agentSessionId: session.id,
        hostId: session.hostId,
        displayName: session.displayName,
        runtime: session.runtime,
        model: session.model,
        version: session.version,
        taskId: assertion.taskId,
        taskHash: assertion.taskDescriptionHash,
        assertionVerified: true,
        pairwiseActSub,
        approvedCapabilityName: capabilityName,
        approvalStrength,
        attestationProvider: host.attestationProvider ?? null,
        attestationTier: host.attestationTier ?? "unverified",
      })
      .where(eq(cibaRequests.authReqId, params.authReqId));

    await tx
      .update(agentSessions)
      .set({ lastActiveAt: new Date() })
      .where(eq(agentSessions.id, session.id));

    bound = true;
  });

  if (!bound) {
    return null;
  }

  return {
    sessionId: session.id,
    agentName: session.displayName,
    capabilityName,
    approvalStrength,
    registeredAgent: {
      name: session.displayName,
      model: session.model,
      runtime: session.runtime,
      version: session.version,
      attestationProvider: host.attestationProvider ?? null,
      attestationTier: host.attestationTier ?? "unverified",
    },
  };
}
