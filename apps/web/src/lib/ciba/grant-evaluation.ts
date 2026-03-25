import { and, eq, inArray } from "drizzle-orm";

import {
  extractProofScopes,
  isIdentityScope,
} from "@/lib/auth/oidc/disclosure-registry";
import { computeSessionState } from "@/lib/ciba/agent-lifecycle";
import { recordUsageIfAllowed } from "@/lib/ciba/usage-ledger";
import { db } from "@/lib/db/connection";
import {
  agentCapabilities,
  agentHostPolicies,
  agentSessionGrants,
  agentSessions,
} from "@/lib/db/schema/agent";

export interface AuthorizationDetail {
  amount?: { currency?: string; value?: string };
  type?: string;
  [key: string]: unknown;
}

interface Constraint {
  field: string;
  op: "eq" | "in" | "max" | "min" | "not_in";
  value?: number | string;
  values?: string[];
}

interface NormalizedGrant {
  capabilityName: string;
  constraints: Constraint[];
  cooldownSec?: number | undefined;
  dailyLimitAmount?: number | undefined;
  dailyLimitCount?: number | undefined;
  hostPolicyId?: string | undefined;
  id: string;
  source: "host_policy" | "session_elevation" | "session_once";
  status: string;
}

interface GrantEvalResult {
  approvalStrength?: string | undefined;
  approved: boolean;
  capabilityName?: string | undefined;
  constraintsJson?: string | undefined;
  grantId?: string | undefined;
  hostPolicyId?: string | undefined;
  reason?: string | undefined;
}

export function normalizeAuthorizationDetails(
  raw: unknown
): AuthorizationDetail[] {
  if (Array.isArray(raw)) {
    return raw;
  }
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

export function deriveCapabilityName(
  details: AuthorizationDetail[],
  scope: string
): string | null {
  // Precedence is strict so a mixed request produces one deterministic
  // capability: purchase details outrank identity scopes, which outrank proof
  // scopes, which outrank openid-only requests.
  if (details.some((detail) => detail.type === "purchase")) {
    return "purchase";
  }

  const scopes = scope.split(" ").filter((item) => item !== "openid");
  if (scopes.some(isIdentityScope)) {
    return "my_profile";
  }

  if (scopes.includes("compliance:key:read")) {
    return "check_compliance";
  }

  if (
    scopes.includes("proof:identity") ||
    extractProofScopes(scopes).length > 0
  ) {
    return "my_proofs";
  }

  return null;
}

export async function resolveCapabilityApprovalStrength(
  capabilityName: string | null | undefined
): Promise<string | undefined> {
  if (!capabilityName) {
    return undefined;
  }

  const capability = await db
    .select({ approvalStrength: agentCapabilities.approvalStrength })
    .from(agentCapabilities)
    .where(eq(agentCapabilities.name, capabilityName))
    .limit(1)
    .get();

  return capability?.approvalStrength;
}

function extractActionParams(
  details: AuthorizationDetail[]
): Record<string, unknown> {
  const purchase = details.find((detail) => detail.type === "purchase");
  if (!purchase) {
    return {};
  }

  return {
    "amount.value": purchase.amount?.value
      ? Number.parseFloat(purchase.amount.value)
      : undefined,
    "amount.currency": purchase.amount?.currency,
    merchant: purchase.merchant,
    item: purchase.item,
  };
}

function parseConstraints(raw: string | null): Constraint[] {
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as Constraint[]) : [];
  } catch {
    return [];
  }
}

function evaluateConstraint(
  constraint: Constraint,
  params: Record<string, unknown>
): boolean {
  const value = params[constraint.field];

  switch (constraint.op) {
    case "max":
      return typeof value === "number" && typeof constraint.value === "number"
        ? value <= constraint.value
        : false;
    case "min":
      return typeof value === "number" && typeof constraint.value === "number"
        ? value >= constraint.value
        : false;
    case "eq":
      return value === constraint.value;
    case "in":
      return Array.isArray(constraint.values)
        ? constraint.values.includes(String(value))
        : false;
    case "not_in":
      return Array.isArray(constraint.values)
        ? !constraint.values.includes(String(value))
        : true;
    default:
      return false;
  }
}

function normalizeGrantRows(
  sessionGrants: Array<{
    capabilityName: string;
    constraints: string | null;
    cooldownSec: number | null;
    dailyLimitAmount: number | null;
    dailyLimitCount: number | null;
    hostPolicyId: string | null;
    id: string;
    source: string;
    status: string;
  }>
): NormalizedGrant[] {
  return sessionGrants.map((grant) => ({
    id: grant.id,
    capabilityName: grant.capabilityName,
    constraints: parseConstraints(grant.constraints),
    dailyLimitAmount: grant.dailyLimitAmount ?? undefined,
    dailyLimitCount: grant.dailyLimitCount ?? undefined,
    cooldownSec: grant.cooldownSec ?? undefined,
    hostPolicyId: grant.hostPolicyId ?? undefined,
    source: grant.source as NormalizedGrant["source"],
    status: grant.status,
  }));
}

export async function ensureDefaultHostPolicies(
  hostId: string,
  capabilityNames: string[],
  source: "default" | "attestation_default"
): Promise<void> {
  if (capabilityNames.length === 0) {
    return;
  }

  const existing = await db
    .select({
      capabilityName: agentHostPolicies.capabilityName,
      source: agentHostPolicies.source,
      status: agentHostPolicies.status,
    })
    .from(agentHostPolicies)
    .where(eq(agentHostPolicies.hostId, hostId))
    .all();

  const existingCapabilities = new Set(
    existing.map((row) => row.capabilityName)
  );

  const values = capabilityNames
    .filter((capabilityName) => !existingCapabilities.has(capabilityName))
    .map((capabilityName) => ({
      hostId,
      capabilityName,
      source,
      status: "active",
    }));

  if (values.length > 0) {
    await db.insert(agentHostPolicies).values(values);
  }
}

export async function seedSessionGrantsFromHostPolicies(
  sessionId: string,
  hostId: string
): Promise<Array<{ capability: string; status: string }>> {
  const policies = await db
    .select({
      capabilityName: agentHostPolicies.capabilityName,
      constraints: agentHostPolicies.constraints,
      cooldownSec: agentHostPolicies.cooldownSec,
      dailyLimitAmount: agentHostPolicies.dailyLimitAmount,
      dailyLimitCount: agentHostPolicies.dailyLimitCount,
      id: agentHostPolicies.id,
      status: agentHostPolicies.status,
    })
    .from(agentHostPolicies)
    .where(
      and(
        eq(agentHostPolicies.hostId, hostId),
        eq(agentHostPolicies.status, "active")
      )
    )
    .all();

  if (policies.length === 0) {
    return [];
  }

  await db.insert(agentSessionGrants).values(
    policies.map((policy) => ({
      hostPolicyId: policy.id,
      capabilityName: policy.capabilityName,
      constraints: policy.constraints,
      dailyLimitAmount: policy.dailyLimitAmount,
      dailyLimitCount: policy.dailyLimitCount,
      cooldownSec: policy.cooldownSec,
      sessionId,
      source: "host_policy",
      status: "active",
      grantedAt: new Date(),
    }))
  );

  return policies.map((policy) => ({
    capability: policy.capabilityName,
    status: "active",
  }));
}

export async function createPendingSessionGrants(
  sessionId: string,
  requestedCapabilities: string[]
): Promise<Array<{ capability: string; status: string }>> {
  if (requestedCapabilities.length === 0) {
    return [];
  }

  const validCaps = await db
    .select({ name: agentCapabilities.name })
    .from(agentCapabilities)
    .where(inArray(agentCapabilities.name, requestedCapabilities));
  if (validCaps.length === 0) {
    return [];
  }

  await db.insert(agentSessionGrants).values(
    validCaps.map((capability) => ({
      capabilityName: capability.name,
      sessionId,
      source: "session_elevation",
      status: "pending",
    }))
  );

  return validCaps.map((capability) => ({
    capability: capability.name,
    status: "pending",
  }));
}

export async function evaluateSessionGrants(
  sessionId: string,
  scope: string,
  authorizationDetails: AuthorizationDetail[]
): Promise<GrantEvalResult> {
  const session = await db
    .select({ status: agentSessions.status })
    .from(agentSessions)
    .where(eq(agentSessions.id, sessionId))
    .limit(1)
    .get();
  if (!session) {
    return { approved: false, reason: "session not found" };
  }

  const sessionState = await computeSessionState(sessionId);
  if (sessionState !== "active") {
    return { approved: false, reason: "session is not active" };
  }

  const capabilityName = deriveCapabilityName(authorizationDetails, scope);
  if (!capabilityName) {
    return { approved: false, reason: "no matching capability for request" };
  }

  const capability = await db
    .select({ approvalStrength: agentCapabilities.approvalStrength })
    .from(agentCapabilities)
    .where(eq(agentCapabilities.name, capabilityName))
    .limit(1)
    .get();

  const approvalStrength = capability?.approvalStrength ?? "session";
  const scopes = scope.split(" ").filter((item) => item !== "openid");
  const containsIdentityScope = scopes.some(isIdentityScope);

  if (approvalStrength === "biometric") {
    return {
      approved: false,
      capabilityName,
      approvalStrength: "biometric",
      reason: "biometric approval required",
    };
  }

  if (containsIdentityScope) {
    return {
      approved: false,
      approvalStrength,
      capabilityName,
      reason: "identity scopes require explicit approval",
    };
  }

  if (approvalStrength === "session") {
    return {
      approved: false,
      approvalStrength,
      capabilityName,
      reason: "session approval required",
    };
  }

  const sessionGrantRows = await db
    .select({
      capabilityName: agentSessionGrants.capabilityName,
      constraints: agentSessionGrants.constraints,
      cooldownSec: agentSessionGrants.cooldownSec,
      dailyLimitAmount: agentSessionGrants.dailyLimitAmount,
      dailyLimitCount: agentSessionGrants.dailyLimitCount,
      hostPolicyId: agentSessionGrants.hostPolicyId,
      id: agentSessionGrants.id,
      source: agentSessionGrants.source,
      status: agentSessionGrants.status,
    })
    .from(agentSessionGrants)
    .where(
      and(
        eq(agentSessionGrants.sessionId, sessionId),
        eq(agentSessionGrants.capabilityName, capabilityName)
      )
    )
    .all();

  const grants = normalizeGrantRows(sessionGrantRows);
  const deniedGrant = grants.find((grant) => grant.status === "denied");
  if (deniedGrant) {
    return { approved: false, reason: "session grant explicitly denied" };
  }

  const activeGrants = grants.filter((grant) => grant.status === "active");
  if (activeGrants.length === 0) {
    return { approved: false, reason: "no active grant for capability" };
  }

  const actionParams = extractActionParams(authorizationDetails);
  const purchase = authorizationDetails.find(
    (detail) => detail.type === "purchase"
  );
  const purchaseAmount = purchase?.amount?.value
    ? Number.parseFloat(purchase.amount.value)
    : undefined;

  for (const grant of activeGrants) {
    const constraintsPass =
      grant.constraints.length === 0 ||
      grant.constraints.every((constraint) =>
        evaluateConstraint(constraint, actionParams)
      );
    if (!constraintsPass) {
      continue;
    }

    const recorded = await recordUsageIfAllowed(
      {
        capabilityName,
        hostPolicyId: grant.hostPolicyId,
        grantId: grant.id,
        sessionId,
        amount: purchaseAmount,
        currency: purchase?.amount?.currency,
      },
      {
        cooldownSec: grant.cooldownSec,
        dailyLimitAmount: grant.dailyLimitAmount,
        dailyLimitCount: grant.dailyLimitCount,
      }
    );

    if (recorded) {
      return {
        approved: true,
        approvalStrength,
        capabilityName,
        constraintsJson: grant.constraints.length
          ? JSON.stringify(grant.constraints)
          : undefined,
        grantId: grant.id,
        hostPolicyId: grant.hostPolicyId,
      };
    }
  }

  return { approved: false, reason: "no grant constraints matched" };
}
