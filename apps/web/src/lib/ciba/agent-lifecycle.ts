import { eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db/connection";
import { agentSessions } from "@/lib/db/schema/agent";

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
