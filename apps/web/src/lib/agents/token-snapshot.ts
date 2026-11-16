import "server-only";

import type {
  AgentAuthorization,
  HostAttestationTier,
} from "@zentity/sdk/protocol";
import type { CibaApproval } from "@/lib/db/schema/ciba";

import { eq } from "drizzle-orm";

import { db } from "@/lib/db/connection";
import { findCibaApproval } from "@/lib/db/queries/ciba";
import { agentTokenSnapshots } from "@/lib/db/schema/agent";

import { buildAgentAuthorization } from "./claims";

interface LoadedTokenSnapshot {
  assertionVerified: boolean;
  attestation: {
    provider: string | null;
    tier: HostAttestationTier;
    verified: boolean;
  };
  authorization: AgentAuthorization;
  authReqId: string;
  hostId: string | null;
  sessionId: string;
}

/**
 * The verified agent runtime behind a CIBA token. What was approved, and how,
 * is read from the request's `ciba_approval` record, keyed by `authReqId`.
 */
export interface StoredTokenSnapshot {
  agentSessionId: string | null;
  assertionVerified: boolean | null;
  attestationProvider: string | null;
  attestationTier: string | null;
  authReqId: string | null;
  hostId: string | null;
  model: string | null;
  runtime: string | null;
  taskHash?: string | null;
  taskId: string | null;
  version: string | null;
}

function asHostAttestationTier(
  value: string | null | undefined
): HostAttestationTier {
  switch (value) {
    case "attested":
    case "self-declared":
    case "unverified":
      return value;
    default:
      return "unverified";
  }
}

/**
 * The agent behind a token and what its approval authorizes, or null when
 * the request had no verified agent or no recorded approval. Pass `approval`
 * when the caller already loaded it.
 */
async function resolveTokenSnapshot(
  row: StoredTokenSnapshot | undefined,
  loadedApproval?: CibaApproval | null
): Promise<LoadedTokenSnapshot | null> {
  if (!(row?.agentSessionId && row.assertionVerified)) {
    return null;
  }
  const approval =
    loadedApproval === undefined && row.authReqId
      ? await findCibaApproval(row.authReqId)
      : loadedApproval;
  const authorization = approval ? buildAgentAuthorization(approval) : null;
  if (!authorization) {
    return null;
  }
  const hostAttestation = asHostAttestationTier(row.attestationTier);

  return {
    authReqId: row.authReqId ?? row.agentSessionId,
    hostId: row.hostId,
    sessionId: row.agentSessionId,
    assertionVerified: Boolean(row.assertionVerified),
    attestation: {
      provider: row.attestationProvider ?? null,
      tier: hostAttestation,
      verified: hostAttestation === "attested",
    },
    authorization,
  };
}

async function upsertTokenSnapshot(
  tokenJti: string,
  audienceClientId: string,
  row: StoredTokenSnapshot
): Promise<void> {
  if (!row.agentSessionId) {
    return;
  }

  await db
    .insert(agentTokenSnapshots)
    .values({
      tokenJti,
      authReqId: row.authReqId,
      clientId: audienceClientId,
      hostId: row.hostId,
      agentSessionId: row.agentSessionId,
      displayName: null,
      runtime: row.runtime,
      model: row.model,
      version: row.version,
      taskId: row.taskId,
      taskHash: row.taskHash ?? null,
      attestationProvider: row.attestationProvider,
      attestationTier: row.attestationTier ?? "unverified",
      assertionVerified: Boolean(row.assertionVerified),
    })
    .onConflictDoUpdate({
      target: agentTokenSnapshots.tokenJti,
      set: {
        authReqId: row.authReqId,
        clientId: audienceClientId,
        hostId: row.hostId,
        agentSessionId: row.agentSessionId,
        runtime: row.runtime,
        model: row.model,
        version: row.version,
        taskId: row.taskId,
        taskHash: row.taskHash ?? null,
        attestationProvider: row.attestationProvider,
        attestationTier: row.attestationTier ?? "unverified",
        assertionVerified: Boolean(row.assertionVerified),
      },
    });
}

function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/**
 * Maps the in-memory CIBA request the poll grant hands to `buildAccessTokenClaims`
 * onto the snapshot shape. The plugin consumes (deletes) the request before the
 * claim contributors run, so the snapshot is built from this object, never
 * re-read from `ciba_request`.
 */
function toStoredSnapshot(row: Record<string, unknown>): StoredTokenSnapshot {
  return {
    agentSessionId: readString(row.agentSessionId),
    assertionVerified:
      typeof row.assertionVerified === "boolean" ? row.assertionVerified : null,
    attestationProvider: readString(row.attestationProvider),
    attestationTier: readString(row.attestationTier),
    authReqId: readString(row.authReqId),
    hostId: readString(row.hostId),
    model: readString(row.model),
    runtime: readString(row.runtime),
    taskHash: readString(row.taskHash),
    taskId: readString(row.taskId),
    version: readString(row.version),
  };
}

interface CibaAgentContribution {
  authorization: AgentAuthorization;
  snapshot: StoredTokenSnapshot;
}

/**
 * What a verified agent's approval authorizes, for the CIBA token response,
 * from the request the grant handler is about to consume. Returns `null` for
 * plain (non-agent) requests, whose token names the client as its actor. The
 * caller stashes the returned `snapshot` so the `/oauth2/token` after-hook can
 * persist it keyed by the minted token's real jti (the AS owns jti; we cannot
 * know it at claim-build time).
 */
export async function buildCibaAgentContribution(
  cibaRequest: Record<string, unknown>,
  approval: CibaApproval | undefined
): Promise<CibaAgentContribution | null> {
  const snapshot = toStoredSnapshot(cibaRequest);
  const resolved = await resolveTokenSnapshot(snapshot, approval ?? null);
  if (!resolved) {
    return null;
  }
  return { authorization: resolved.authorization, snapshot };
}

export async function persistTokenSnapshot(input: {
  audienceClientId: string;
  snapshot: StoredTokenSnapshot;
  tokenJti: string;
}): Promise<void> {
  await upsertTokenSnapshot(
    input.tokenJti,
    input.audienceClientId,
    input.snapshot
  );
}

async function findStoredTokenSnapshotByJti(
  tokenJti: string
): Promise<StoredTokenSnapshot | null> {
  const row = await db
    .select({
      agentSessionId: agentTokenSnapshots.agentSessionId,
      assertionVerified: agentTokenSnapshots.assertionVerified,
      attestationProvider: agentTokenSnapshots.attestationProvider,
      attestationTier: agentTokenSnapshots.attestationTier,
      authReqId: agentTokenSnapshots.authReqId,
      hostId: agentTokenSnapshots.hostId,
      model: agentTokenSnapshots.model,
      runtime: agentTokenSnapshots.runtime,
      taskHash: agentTokenSnapshots.taskHash,
      taskId: agentTokenSnapshots.taskId,
      version: agentTokenSnapshots.version,
    })
    .from(agentTokenSnapshots)
    .where(eq(agentTokenSnapshots.tokenJti, tokenJti))
    .limit(1)
    .get();

  return row ?? null;
}

export async function resolveTokenSnapshotForTokenJti(
  tokenJti: string
): Promise<LoadedTokenSnapshot | null> {
  const storedSnapshot = await findStoredTokenSnapshotByJti(tokenJti);
  return resolveTokenSnapshot(storedSnapshot ?? undefined);
}
