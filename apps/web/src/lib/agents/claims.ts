import type {
  AccessTokenClaims,
  CapabilityClaim,
  HostAttestationTier,
  OversightMethod,
} from "@zentity/sdk/protocol";

import { AAP_CLAIMS_VERSION } from "@zentity/sdk/protocol";

interface BuildAapClaimsInput {
  act: {
    did?: string | null;
    hostAttestation: HostAttestationTier;
    hostId?: string | null;
    operator?: string | null;
    sessionId: string;
    sub: string;
    type?: string | null;
  };
  audit: {
    cibaRequestId?: string | null;
    contextId: string;
    releaseId: string;
    requestId?: string | null;
  };
  capabilities?: CapabilityClaim[] | null;
  delegation?: AccessTokenClaims["delegation"] | null;
  oversight: {
    approvalId: string;
    approvedAt: number;
    method: OversightMethod;
  };
  task: {
    constraints?: unknown;
    createdAt: number;
    description: string;
    expiresAt: number;
    hash: string;
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function normalizeCapabilityClaims(
  capabilities: CapabilityClaim[] | null | undefined
): CapabilityClaim[] {
  return (capabilities ?? [])
    .filter(
      (capability) =>
        typeof capability.action === "string" && capability.action.length > 0
    )
    .toSorted((left, right) => left.action.localeCompare(right.action));
}

export function buildAapClaims(input: BuildAapClaimsInput): AccessTokenClaims {
  const capabilities = normalizeCapabilityClaims(input.capabilities);

  return {
    act: {
      sub: input.act.sub,
      host_attestation: input.act.hostAttestation,
      session_id: input.act.sessionId,
      ...(input.act.hostAttestation === "attested" && input.act.did
        ? { did: input.act.did }
        : {}),
      ...(input.act.hostId ? { host_id: input.act.hostId } : {}),
      ...(input.act.operator ? { operator: input.act.operator } : {}),
      ...(input.act.type ? { type: input.act.type } : {}),
    },
    task: {
      hash: input.task.hash,
      description: input.task.description,
      created_at: input.task.createdAt,
      expires_at: input.task.expiresAt,
      ...(input.task.constraints === undefined
        ? {}
        : { constraints: input.task.constraints }),
    },
    oversight: {
      approval_id: input.oversight.approvalId,
      approved_at: input.oversight.approvedAt,
      method: input.oversight.method,
    },
    audit: {
      release_id: input.audit.releaseId,
      context_id: input.audit.contextId,
      ...(input.audit.requestId ? { request_id: input.audit.requestId } : {}),
      ...(input.audit.cibaRequestId
        ? { ciba_request_id: input.audit.cibaRequestId }
        : {}),
    },
    delegation: input.delegation ?? {
      depth: 0,
      max_depth: 1,
      parent_jti: null,
    },
    capabilities,
    aap_claims_version: AAP_CLAIMS_VERSION,
  };
}

export function getAapClaimsFromPayload(
  payload: Record<string, unknown>
): Partial<AccessTokenClaims> {
  const parsedClaims: Partial<AccessTokenClaims> = {};

  const act = asRecord(payload.act);
  if (
    act &&
    typeof act.sub === "string" &&
    typeof act.host_attestation === "string" &&
    typeof act.session_id === "string"
  ) {
    parsedClaims.act = {
      sub: act.sub,
      host_attestation: act.host_attestation as HostAttestationTier,
      session_id: act.session_id,
      ...(typeof act.did === "string" ? { did: act.did } : {}),
      ...(typeof act.host_id === "string" ? { host_id: act.host_id } : {}),
      ...(typeof act.operator === "string" ? { operator: act.operator } : {}),
      ...(typeof act.type === "string" ? { type: act.type } : {}),
    };
  }

  const task = asRecord(payload.task);
  if (
    task &&
    typeof task.hash === "string" &&
    typeof task.description === "string" &&
    typeof task.created_at === "number" &&
    typeof task.expires_at === "number"
  ) {
    parsedClaims.task = {
      hash: task.hash,
      description: task.description,
      created_at: task.created_at,
      expires_at: task.expires_at,
      ...(task.constraints === undefined
        ? {}
        : { constraints: task.constraints }),
    };
  }

  const oversight = asRecord(payload.oversight);
  if (
    oversight &&
    typeof oversight.approval_id === "string" &&
    typeof oversight.approved_at === "number" &&
    typeof oversight.method === "string"
  ) {
    parsedClaims.oversight = {
      approval_id: oversight.approval_id,
      approved_at: oversight.approved_at,
      method: oversight.method as OversightMethod,
    };
  }

  const audit = asRecord(payload.audit);
  if (
    audit &&
    typeof audit.release_id === "string" &&
    typeof audit.context_id === "string"
  ) {
    parsedClaims.audit = {
      release_id: audit.release_id,
      context_id: audit.context_id,
      ...(typeof audit.request_id === "string"
        ? { request_id: audit.request_id }
        : {}),
      ...(typeof audit.ciba_request_id === "string"
        ? { ciba_request_id: audit.ciba_request_id }
        : {}),
    };
  }

  const delegation = asRecord(payload.delegation);
  if (
    delegation &&
    typeof delegation.depth === "number" &&
    typeof delegation.max_depth === "number" &&
    ("parent_jti" in delegation
      ? delegation.parent_jti === null ||
        typeof delegation.parent_jti === "string"
      : true)
  ) {
    parsedClaims.delegation = {
      depth: delegation.depth,
      max_depth: delegation.max_depth,
      parent_jti:
        delegation.parent_jti === undefined
          ? null
          : (delegation.parent_jti as string | null),
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

    parsedClaims.capabilities = normalizeCapabilityClaims(capabilities);
  }

  if (payload.aap_claims_version === AAP_CLAIMS_VERSION) {
    parsedClaims.aap_claims_version = AAP_CLAIMS_VERSION;
  }

  return parsedClaims;
}

export class DelegationDepthExceededError extends Error {
  readonly code = "delegation_depth_exceeded";

  constructor(message = "Delegation depth exceeded") {
    super(message);
    this.name = "DelegationDepthExceededError";
  }
}

export function deriveDelegationClaim(input: {
  parent?: Partial<AccessTokenClaims> | null;
  parentJti?: string | null;
}): AccessTokenClaims["delegation"] {
  const parentDelegation = input.parent?.delegation;
  const parentDepth = parentDelegation?.depth ?? 0;
  const maxDepth = parentDelegation?.max_depth ?? 1;
  const nextDepth = parentDepth + 1;

  if (nextDepth > maxDepth) {
    throw new DelegationDepthExceededError();
  }

  return {
    depth: nextDepth,
    max_depth: maxDepth,
    parent_jti: input.parentJti ?? parentDelegation?.parent_jti ?? null,
  };
}
