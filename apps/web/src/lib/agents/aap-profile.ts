import { eq } from "drizzle-orm";

import { db } from "@/lib/db/connection";
import { agentTokenSnapshots } from "@/lib/db/schema/agent";
import { cibaRequests } from "@/lib/db/schema/ciba";

import { resolveAgentSubForClient } from "./pairwise";

interface AapAgentClaim {
  id: string;
  model?:
    | {
        id?: string;
        version?: string;
      }
    | undefined;
  runtime?:
    | {
        attested: boolean;
        environment?: string;
      }
    | undefined;
  type: "mcp-agent";
}

interface AapTaskClaim {
  id: string;
  purpose?: string | undefined;
}

interface AapCapabilityClaim {
  action: string;
  constraints?: unknown;
}

interface AapOversightClaim {
  approval_reference?: string | undefined;
  requires_human_approval_for?: string[] | undefined;
}

interface AapDelegationClaim {
  chain: string[];
  depth: number;
  parent_jti?: string | undefined;
}

interface AapAuditClaim {
  session_id: string;
  trace_id: string;
}

interface AapProfile {
  agent?: AapAgentClaim;
  audit?: AapAuditClaim;
  capabilities?: AapCapabilityClaim[];
  delegation?: AapDelegationClaim;
  oversight?: AapOversightClaim;
  task?: AapTaskClaim;
}

interface AapProjectionInput {
  actorId?: string | null | undefined;
  approvalMethod?: string | null | undefined;
  approvalReference?: string | null | undefined;
  approvalStrength?: string | null | undefined;
  attestationProvider?: string | null | undefined;
  attestationTier?: string | null | undefined;
  authReqId?: string | null | undefined;
  capabilities?: AapCapabilityClaim[] | null | undefined;
  delegation?: AapDelegationClaim | null | undefined;
  model?: string | null | undefined;
  requiresHumanApprovalFor?: string[] | null | undefined;
  runtime?: string | null | undefined;
  sessionVersion?: string | null | undefined;
  taskId?: string | null | undefined;
  taskPurpose?: string | null | undefined;
  traceId?: string | null | undefined;
}

interface LoadedCibaAapSnapshot {
  aap: AapProfile;
  assertionVerified: boolean;
  attestation: {
    provider: string | null;
    tier: string;
    verified: boolean;
  };
  authReqId: string;
  hostId: string | null;
  sessionId: string;
}

interface StoredAapSnapshot {
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
  authReqId: string | null;
  hostId: string | null;
  model: string | null;
  runtime: string | null;
  taskId: string | null;
  version: string | null;
}

type StoredAapSnapshotRow = StoredAapSnapshot;

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

function asStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? (value as string[])
    : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function buildAapProfile(input: AapProjectionInput): AapProfile {
  const actorId = input.actorId ?? undefined;
  const capabilityClaims = input.capabilities?.filter(
    (capability) => capability.action.length > 0
  );

  const taskPurpose =
    input.taskPurpose ??
    (capabilityClaims && capabilityClaims.length > 0
      ? capabilityClaims[0]?.action
      : undefined);

  const approvalReference =
    input.approvalReference ??
    (input.approvalMethod
      ? `${input.approvalMethod}:${input.authReqId ?? "request"}`
      : (input.authReqId ?? undefined));

  const requiresHumanApproval =
    input.requiresHumanApprovalFor ??
    (taskPurpose && input.approvalStrength && input.approvalStrength !== "none"
      ? [taskPurpose]
      : undefined);

  const traceId = input.traceId ?? input.authReqId ?? undefined;

  return {
    ...(actorId
      ? {
          agent: {
            id: actorId,
            type: "mcp-agent" as const,
            ...(input.model || input.sessionVersion
              ? {
                  model: {
                    ...(input.model ? { id: input.model } : {}),
                    ...(input.sessionVersion
                      ? { version: input.sessionVersion }
                      : {}),
                  },
                }
              : {}),
            ...(input.runtime || input.attestationTier
              ? {
                  runtime: {
                    attested: input.attestationTier === "attested",
                    ...(input.runtime ? { environment: input.runtime } : {}),
                  },
                }
              : {}),
          },
        }
      : {}),
    ...(capabilityClaims && capabilityClaims.length > 0
      ? { capabilities: capabilityClaims }
      : {}),
    ...(input.taskId || input.authReqId
      ? {
          task: {
            id: input.taskId ?? input.authReqId ?? "",
            ...(taskPurpose ? { purpose: taskPurpose } : {}),
          },
        }
      : {}),
    ...(approvalReference || requiresHumanApproval
      ? {
          oversight: {
            ...(approvalReference
              ? { approval_reference: approvalReference }
              : {}),
            ...(requiresHumanApproval
              ? { requires_human_approval_for: requiresHumanApproval }
              : {}),
          },
        }
      : {}),
    ...(input.delegation ? { delegation: input.delegation } : {}),
    ...(actorId && traceId
      ? {
          audit: {
            trace_id: traceId,
            session_id: actorId,
          },
        }
      : {}),
  };
}

export function readAapProfileFromPayload(
  payload: Record<string, unknown>
): AapProfile {
  const profile: AapProfile = {};

  const agent = asRecord(payload.agent);
  if (agent && typeof agent.id === "string") {
    profile.agent = {
      id: agent.id,
      type: "mcp-agent",
      ...(asRecord(agent.model)
        ? { model: asRecord(agent.model) as AapAgentClaim["model"] }
        : {}),
      ...(asRecord(agent.runtime)
        ? { runtime: asRecord(agent.runtime) as AapAgentClaim["runtime"] }
        : {}),
    };
  }

  const task = asRecord(payload.task);
  if (task && typeof task.id === "string") {
    profile.task = {
      id: task.id,
      ...(typeof task.purpose === "string" ? { purpose: task.purpose } : {}),
    };
  }

  if (Array.isArray(payload.capabilities)) {
    const capabilities = payload.capabilities
      .map((capability) => asRecord(capability))
      .filter((capability): capability is Record<string, unknown> =>
        Boolean(capability && typeof capability.action === "string")
      )
      .map((capability) => ({
        action: capability.action as string,
        ...(capability.constraints === undefined
          ? {}
          : { constraints: capability.constraints }),
      }));

    if (capabilities.length > 0) {
      profile.capabilities = capabilities;
    }
  }

  const oversight = asRecord(payload.oversight);
  if (oversight) {
    profile.oversight = {
      ...(typeof oversight.approval_reference === "string"
        ? { approval_reference: oversight.approval_reference }
        : {}),
      ...(asStringArray(oversight.requires_human_approval_for)
        ? {
            requires_human_approval_for:
              oversight.requires_human_approval_for as string[],
          }
        : {}),
    };
  }

  const delegation = asRecord(payload.delegation);
  if (
    delegation &&
    typeof delegation.depth === "number" &&
    asStringArray(delegation.chain)
  ) {
    profile.delegation = {
      depth: delegation.depth,
      chain: delegation.chain as string[],
      ...(typeof delegation.parent_jti === "string"
        ? { parent_jti: delegation.parent_jti }
        : {}),
    };
  }

  const audit = asRecord(payload.audit);
  if (
    audit &&
    typeof audit.trace_id === "string" &&
    typeof audit.session_id === "string"
  ) {
    profile.audit = {
      trace_id: audit.trace_id,
      session_id: audit.session_id,
    };
  }

  return profile;
}

export function buildDelegationClaim(input: {
  baseProfile: AapProfile;
  parentJti?: string | null;
}): AapDelegationClaim | undefined {
  const baseChain = input.baseProfile.delegation?.chain
    ? [...input.baseProfile.delegation.chain]
    : [];
  const actorId = input.baseProfile.agent?.id;

  if (actorId && baseChain.at(-1) !== actorId) {
    baseChain.push(actorId);
  }

  if (baseChain.length === 0 && !input.parentJti) {
    return undefined;
  }

  return {
    depth: (input.baseProfile.delegation?.depth ?? 0) + 1,
    chain: baseChain,
    ...(input.parentJti ? { parent_jti: input.parentJti } : {}),
  };
}

function getAapSnapshotCapabilities(row: StoredAapSnapshotRow) {
  const constraints = parseConstraints(row.approvedConstraints);

  return row.approvedCapabilityName
    ? [
        {
          action: row.approvedCapabilityName,
          ...(constraints === undefined ? {} : { constraints }),
        },
      ]
    : undefined;
}

async function buildLoadedSnapshot(
  row: StoredAapSnapshotRow | undefined,
  audienceClientId: string
): Promise<LoadedCibaAapSnapshot | null> {
  if (!(row?.agentSessionId && row.assertionVerified)) {
    return null;
  }

  const actorId = await resolveAgentSubForClient(
    row.agentSessionId,
    audienceClientId
  );

  const capabilities = getAapSnapshotCapabilities(row);

  const approvalReference =
    row.approvedGrantId ??
    row.approvedHostPolicyId ??
    (row.approvalMethod
      ? `${row.approvalMethod}:${row.authReqId ?? row.agentSessionId}`
      : (row.authReqId ?? row.agentSessionId));

  return {
    authReqId: row.authReqId ?? row.agentSessionId,
    hostId: row.hostId,
    sessionId: row.agentSessionId,
    assertionVerified: Boolean(row.assertionVerified),
    attestation: {
      provider: row.attestationProvider ?? null,
      tier: row.attestationTier ?? "unverified",
      verified: row.attestationTier === "attested",
    },
    aap: buildAapProfile({
      actorId,
      approvalMethod: row.approvalMethod,
      approvalReference,
      approvalStrength: row.approvalStrength,
      attestationProvider: row.attestationProvider,
      attestationTier: row.attestationTier,
      authReqId: row.authReqId ?? row.agentSessionId,
      capabilities,
      model: row.model,
      runtime: row.runtime,
      sessionVersion: row.version,
      taskId: row.taskId,
    }),
  };
}

async function upsertTokenSnapshot(
  tokenJti: string,
  audienceClientId: string,
  row: StoredAapSnapshotRow
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

function getCibaSnapshotRow(authReqId: string) {
  return db
    .select({
      agentSessionId: cibaRequests.agentSessionId,
      approvalMethod: cibaRequests.approvalMethod,
      approvalStrength: cibaRequests.approvalStrength,
      assertionVerified: cibaRequests.assertionVerified,
      approvedCapabilityName: cibaRequests.approvedCapabilityName,
      approvedConstraints: cibaRequests.approvedConstraints,
      approvedGrantId: cibaRequests.approvedGrantId,
      approvedHostPolicyId: cibaRequests.approvedHostPolicyId,
      attestationProvider: cibaRequests.attestationProvider,
      attestationTier: cibaRequests.attestationTier,
      authReqId: cibaRequests.authReqId,
      hostId: cibaRequests.hostId,
      model: cibaRequests.model,
      runtime: cibaRequests.runtime,
      taskId: cibaRequests.taskId,
      version: cibaRequests.version,
    })
    .from(cibaRequests)
    .where(eq(cibaRequests.authReqId, authReqId))
    .limit(1)
    .get();
}

export async function persistAapSnapshotForCibaToken(
  authReqId: string,
  audienceClientId: string
): Promise<(AapProfile & { jti: string }) | null> {
  const row = await getCibaSnapshotRow(authReqId);
  const loadedSnapshot = await buildLoadedSnapshot(row, audienceClientId);
  if (!(row && loadedSnapshot)) {
    return null;
  }

  await upsertTokenSnapshot(authReqId, audienceClientId, row);

  return {
    jti: authReqId,
    ...loadedSnapshot.aap,
  };
}

export async function persistAapSnapshotForToken(input: {
  audienceClientId: string;
  snapshot: StoredAapSnapshot;
  tokenJti: string;
}): Promise<void> {
  await upsertTokenSnapshot(
    input.tokenJti,
    input.audienceClientId,
    input.snapshot
  );
}

export async function loadStoredAapSnapshotForTokenJti(
  tokenJti: string
): Promise<StoredAapSnapshot | null> {
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
      hostId: agentTokenSnapshots.hostId,
      model: agentTokenSnapshots.model,
      runtime: agentTokenSnapshots.runtime,
      taskId: agentTokenSnapshots.taskId,
      version: agentTokenSnapshots.version,
    })
    .from(agentTokenSnapshots)
    .where(eq(agentTokenSnapshots.tokenJti, tokenJti))
    .limit(1)
    .get();

  return row ?? null;
}

export async function loadAapProfileForTokenJti(
  tokenJti: string,
  audienceClientId: string
): Promise<LoadedCibaAapSnapshot | null> {
  const row = await loadStoredAapSnapshotForTokenJti(tokenJti);
  return buildLoadedSnapshot(row ?? undefined, audienceClientId);
}

export async function loadAapProfileForCibaRequest(
  authReqId: string,
  audienceClientId: string
): Promise<LoadedCibaAapSnapshot | null> {
  const row = await getCibaSnapshotRow(authReqId);
  return buildLoadedSnapshot(row, audienceClientId);
}
