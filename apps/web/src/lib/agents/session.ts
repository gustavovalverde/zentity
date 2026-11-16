import { AGENT_BOOTSTRAP_SCOPES } from "@zentity/sdk/agent-contract";
import {
  decodeJwtPayloadStrict,
  type TaskHashInput,
  taskHash,
} from "@zentity/sdk/protocol";
import { eq, inArray, lt } from "drizzle-orm";
import { importJWK, jwtVerify } from "jose";
import { z } from "zod";

import { parseStoredStringArray } from "@/lib/db/adapter-compat";
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
    const rawPayload = decodeJwtPayloadStrict(jwt) as { iss?: string };
    const sessionId = rawPayload.iss;
    if (!sessionId) {
      return null;
    }

    const session = await db
      .select({
        hostId: agentSessions.hostId,
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
    const { payload } = await jwtVerify(jwt, publicKey, {
      algorithms: ["EdDSA"],
      issuer: sessionId,
      typ: "agent-assertion+jwt",
      requiredClaims: ["jti", "exp"],
    });

    const lifecycle = await computeSessionState(sessionId);
    if (lifecycle !== "active") {
      return null;
    }

    const { jti, exp } = payload;
    if (
      typeof jti !== "string" ||
      exp === undefined ||
      payload.host_id !== session.hostId
    ) {
      return null;
    }

    return {
      exp,
      sessionId,
      hostId: session.hostId,
      jti,
      taskId: payload.task_id as string | undefined,
      taskDescriptionHash: payload.task_hash as string | undefined,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Binding a verified assertion to a CIBA request
// ---------------------------------------------------------------------------

interface BoundAgentAssertion {
  agentName: string;
  /** The user's authentication that registered the agent session. */
  authContextId: string | null;
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
  authReqId: string;
}

/** Whether the assertion's `task_hash` is the hash of this request. */
async function matchesTaskHash(
  assertion: AgentAssertionResult,
  request: TaskHashInput
): Promise<boolean> {
  if (!assertion.taskDescriptionHash) {
    return false;
  }
  try {
    return (await taskHash(request)) === assertion.taskDescriptionHash;
  } catch {
    // Details outside the canonical JSON domain match no assertion.
    return false;
  }
}

function formString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Checks an Agent-Assertion against a bc-authorize request before the CIBA
 * plugin stores it: the session's signature, a live session of its host, and
 * a `task_hash` over this request's binding message, scopes, `acr_values`,
 * and `authorization_details`. It does not reserve the assertion `jti`;
 * binding the stored request does that once the plugin has stored it.
 */
export async function verifyAgentAssertionForRequest(
  body: Record<string, unknown>,
  assertionJwt: string
): Promise<boolean> {
  const bindingMessage = formString(body.binding_message);
  const scope = formString(body.scope);
  if (!(bindingMessage && scope)) {
    return false;
  }
  const assertion = await verifyAgentAssertion(assertionJwt);
  return Boolean(
    assertion &&
      (await matchesTaskHash(assertion, {
        bindingMessage,
        scope,
        acrValues: formString(body.acr_values),
        authorizationDetails: formString(body.authorization_details),
      }))
  );
}

export async function bindAgentAssertionToCibaRequest(
  params: BindAgentAssertionParams
): Promise<BoundAgentAssertion | null> {
  const cibaRow = await db
    .select({
      acrValues: cibaRequests.acrValues,
      authorizationDetails: cibaRequests.authorizationDetails,
      bindingMessage: cibaRequests.bindingMessage,
      clientId: cibaRequests.clientId,
      scope: cibaRequests.scope,
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
  if (
    !(
      assertion &&
      (await matchesTaskHash(assertion, {
        bindingMessage: cibaRow.bindingMessage,
        scope: cibaRow.scope,
        acrValues: parseStoredStringArray(cibaRow.acrValues),
        authorizationDetails: cibaRow.authorizationDetails,
      }))
    )
  ) {
    return null;
  }

  const session = await db
    .select({
      authContextId: agentSessions.authContextId,
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
    authContextId: session.authContextId,
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

// ---------------------------------------------------------------------------
// Agent bootstrap scope set and token use
// The scopes and the agent-configuration schema live in @zentity/sdk/agent-contract.
// ---------------------------------------------------------------------------

export const AGENT_BOOTSTRAP_SCOPE_SET = new Set<string>(
  AGENT_BOOTSTRAP_SCOPES
);

export const AGENT_BOOTSTRAP_TOKEN_USE = "agent_bootstrap";

// ---------------------------------------------------------------------------
// Agent Registration (host + session request schemas)
// Keep aligned with packages/sdk/src/agent-registration.ts.
// ---------------------------------------------------------------------------

export const registerHostRequestSchema = z.object({
  did: z.string().min(1),
  name: z.string().min(1).max(255),
});

const agentDisplaySchema = z.object({
  model: z.string().max(128).optional(),
  name: z.string().min(1).max(128),
  runtime: z.string().max(128).optional(),
  version: z.string().max(64).optional(),
});

export const registerSessionRequestSchema = z.object({
  hostJwt: z.string().min(1),
  did: z.string().min(1),
  requestedCapabilities: z.array(z.string()).optional(),
  display: agentDisplaySchema,
});
