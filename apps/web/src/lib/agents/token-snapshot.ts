import "server-only";

import type {
  AapAccessTokenClaims,
  CapabilityClaim,
  HostAttestationTier,
} from "@zentity/sdk/protocol";

import { createHash } from "node:crypto";

import { encodeEd25519DidKeyFromJwk } from "@zentity/sdk/protocol";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db/connection";
import { agentHosts, agentTokenSnapshots } from "@/lib/db/schema/agent";

import { resolveAgentSubForClient } from "./actor-subject";
import { buildAapClaims, resolveOversightMethod } from "./claims";

const DEFAULT_RELEASE_ID =
  process.env.RELEASE_ID ??
  process.env.GIT_SHA ??
  process.env.RAILWAY_GIT_COMMIT_SHA ??
  "dev";

interface LoadedTokenSnapshot {
  assertionVerified: boolean;
  attestation: {
    provider: string | null;
    tier: HostAttestationTier;
    verified: boolean;
  };
  authReqId: string;
  claims: AapAccessTokenClaims;
  hostId: string | null;
  sessionId: string;
}

export interface StoredTokenSnapshot {
  agentSessionId: string | null;
  approvalMethod: string | null;
  approvalStrength: string | null;
  approvedCapabilityName: string | null;
  approvedConstraints: string | null;
  approvedGrantId: string | null;
  approvedHostPolicyId: string | null;
  assertionVerified: boolean | null;
  attestationProvider: string | null;
  attestationTier: string | null;
  authContextId?: string | null;
  authReqId: string | null;
  bindingMessage?: string | null;
  createdAt?: Date | null;
  expiresAt?: Date | null;
  hostId: string | null;
  model: string | null;
  runtime: string | null;
  taskHash?: string | null;
  taskId: string | null;
  version: string | null;
}

function parseConstraints(raw: string | null | undefined): unknown {
  if (!raw) {
    return undefined;
  }

  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
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

function toUnixSeconds(value: Date | null | undefined, fallback = new Date()) {
  return Math.floor((value ?? fallback).getTime() / 1000);
}

function buildApprovalId(row: StoredTokenSnapshot): string {
  return (
    row.approvedGrantId ??
    row.approvedHostPolicyId ??
    row.authReqId ??
    row.agentSessionId ??
    "agent-approval"
  );
}

function buildTaskDescription(row: StoredTokenSnapshot): string {
  return (
    row.bindingMessage ??
    row.approvedCapabilityName ??
    row.taskId ??
    row.authReqId ??
    "agent-request"
  );
}

function buildTaskHash(row: StoredTokenSnapshot): string {
  if (row.taskHash) {
    return row.taskHash;
  }

  return createHash("sha256").update(buildTaskDescription(row)).digest("hex");
}

function buildCapabilitiesFromConstraints(
  capabilityName: string | null,
  constraints: unknown
): CapabilityClaim[] | null {
  if (!capabilityName) {
    return null;
  }

  return [
    {
      action: capabilityName,
      ...(constraints === undefined ? {} : { constraints }),
    },
  ];
}

async function findHostDid(
  hostId: string | null | undefined
): Promise<string | undefined> {
  if (!hostId) {
    return undefined;
  }

  const host = await db
    .select({ publicKey: agentHosts.publicKey })
    .from(agentHosts)
    .where(eq(agentHosts.id, hostId))
    .limit(1)
    .get();

  return host ? encodeEd25519DidKeyFromJwk(host.publicKey) : undefined;
}

async function resolveTokenSnapshot(
  row: StoredTokenSnapshot | undefined,
  audienceClientId: string
): Promise<LoadedTokenSnapshot | null> {
  if (!(row?.agentSessionId && row.assertionVerified)) {
    return null;
  }

  const [pairwiseActorSub, hostDid] = await Promise.all([
    resolveAgentSubForClient(row.agentSessionId, audienceClientId),
    findHostDid(row.hostId),
  ]);
  const hostAttestation = asHostAttestationTier(row.attestationTier);
  const constraints = parseConstraints(row.approvedConstraints);

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
    claims: buildAapClaims({
      act: {
        sub: pairwiseActorSub,
        sessionId: row.agentSessionId,
        hostAttestation,
        ...(hostDid ? { did: hostDid } : {}),
        ...(row.hostId ? { hostId: row.hostId } : {}),
        type: "mcp-agent",
      },
      task: {
        hash: buildTaskHash(row),
        description: buildTaskDescription(row),
        createdAt: toUnixSeconds(row.createdAt),
        expiresAt: toUnixSeconds(row.expiresAt, row.createdAt ?? new Date()),
        ...(constraints === undefined ? {} : { constraints }),
      },
      oversight: {
        approvalId: buildApprovalId(row),
        approvedAt: toUnixSeconds(row.createdAt),
        method: resolveOversightMethod(
          row.approvalMethod,
          row.approvalStrength
        ),
      },
      audit: {
        releaseId: DEFAULT_RELEASE_ID,
        contextId: row.authContextId ?? row.authReqId ?? row.agentSessionId,
        ...(row.authReqId ? { requestId: row.authReqId } : {}),
        ...(row.authReqId ? { cibaRequestId: row.authReqId } : {}),
      },
      capabilities: buildCapabilitiesFromConstraints(
        row.approvedCapabilityName,
        constraints
      ),
    }),
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
      approvalMethod: row.approvalMethod,
      approvedCapabilityName: row.approvedCapabilityName,
      approvedConstraints: row.approvedConstraints,
      approvedGrantId: row.approvedGrantId,
      approvedHostPolicyId: row.approvedHostPolicyId,
      approvalStrength: row.approvalStrength,
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
        approvalMethod: row.approvalMethod,
        approvedCapabilityName: row.approvedCapabilityName,
        approvedConstraints: row.approvedConstraints,
        approvedGrantId: row.approvedGrantId,
        approvedHostPolicyId: row.approvedHostPolicyId,
        approvalStrength: row.approvalStrength,
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
    approvalMethod: readString(row.approvalMethod),
    approvalStrength: readString(row.approvalStrength),
    approvedCapabilityName: readString(row.approvedCapabilityName),
    approvedConstraints: readString(row.approvedConstraints),
    approvedGrantId: readString(row.approvedGrantId),
    approvedHostPolicyId: readString(row.approvedHostPolicyId),
    assertionVerified:
      typeof row.assertionVerified === "boolean" ? row.assertionVerified : null,
    attestationProvider: readString(row.attestationProvider),
    attestationTier: readString(row.attestationTier),
    authContextId: readString(row.authContextId),
    authReqId: readString(row.authReqId),
    bindingMessage: readString(row.bindingMessage),
    createdAt: row.createdAt instanceof Date ? row.createdAt : null,
    expiresAt: row.expiresAt instanceof Date ? row.expiresAt : null,
    hostId: readString(row.hostId),
    model: readString(row.model),
    runtime: readString(row.runtime),
    taskHash: readString(row.taskHash),
    taskId: readString(row.taskId),
    version: readString(row.version),
  };
}

interface CibaAgentContribution {
  claims: AapAccessTokenClaims;
  snapshot: StoredTokenSnapshot;
}

/**
 * Builds the agent AAP claims embedded in a CIBA-issued access token from the
 * consumed request the grant handler holds. Returns `null` for plain (non-agent)
 * requests, where the token keeps the provider's `act: { sub: client_id }`. The
 * caller stashes the returned `snapshot` so the `/oauth2/token` after-hook can
 * persist it keyed by the minted token's real jti (the AS owns jti; we cannot
 * know it at claim-build time).
 */
export async function buildCibaAgentContribution(
  cibaRequest: Record<string, unknown>,
  audienceClientId: string
): Promise<CibaAgentContribution | null> {
  const snapshot = toStoredSnapshot(cibaRequest);
  const resolved = await resolveTokenSnapshot(snapshot, audienceClientId);
  if (!resolved) {
    return null;
  }
  return { claims: resolved.claims, snapshot };
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

export async function findStoredTokenSnapshotByJti(
  tokenJti: string
): Promise<StoredTokenSnapshot | null> {
  const row = await db
    .select({
      agentSessionId: agentTokenSnapshots.agentSessionId,
      approvalMethod: agentTokenSnapshots.approvalMethod,
      approvalStrength: agentTokenSnapshots.approvalStrength,
      assertionVerified: agentTokenSnapshots.assertionVerified,
      approvedCapabilityName: agentTokenSnapshots.approvedCapabilityName,
      approvedConstraints: agentTokenSnapshots.approvedConstraints,
      approvedGrantId: agentTokenSnapshots.approvedGrantId,
      approvedHostPolicyId: agentTokenSnapshots.approvedHostPolicyId,
      attestationProvider: agentTokenSnapshots.attestationProvider,
      attestationTier: agentTokenSnapshots.attestationTier,
      authReqId: agentTokenSnapshots.authReqId,
      createdAt: agentTokenSnapshots.createdAt,
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
  tokenJti: string,
  audienceClientId: string
): Promise<LoadedTokenSnapshot | null> {
  const storedSnapshot = await findStoredTokenSnapshotByJti(tokenJti);
  return resolveTokenSnapshot(storedSnapshot ?? undefined, audienceClientId);
}
