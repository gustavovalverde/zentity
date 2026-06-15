import {
  PAYMENT_AUTHORIZATION_CAPABILITY,
  PAYMENT_AUTHORIZATION_TYPE,
} from "@zentity/sdk/protocol";
import { and, eq, gte, inArray, sql } from "drizzle-orm";

import { computeSessionState } from "@/lib/agents/session";
import { isIdentityScope } from "@/lib/auth/oidc/disclosure/registry";
import { db } from "@/lib/db/connection";
import {
  agentCapabilities,
  agentHostPolicies,
  agentSessionGrants,
  agentSessions,
  capabilityUsageLedger,
} from "@/lib/db/schema/agent";

import { type AuthorizationDetail, deriveCapabilityName } from "./capability";

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

function extractActionParams(
  details: AuthorizationDetail[]
): Record<string, unknown> {
  const payment = details.find(
    (detail) => detail.type === PAYMENT_AUTHORIZATION_TYPE
  );
  if (payment) {
    const chain = payment.chain as
      | { namespace?: string; reference?: string }
      | undefined;
    return {
      "amount.value": payment.amount?.value
        ? Number.parseFloat(payment.amount.value)
        : undefined,
      "amount.currency": payment.amount?.currency,
      // Surface the unit so a boundary can pin it (e.g. {field:"amount.unit",
      // op:"eq", value:"base"}). amount.value caps are in whatever unit the
      // spend declares, so a unit eq constraint prevents a base-vs-display cap
      // mismatch.
      "amount.unit": (payment.amount as { unit?: string } | undefined)?.unit,
      recipient: payment.recipient as string | undefined,
      "chain.namespace": chain?.namespace,
      "chain.reference": chain?.reference,
    };
  }

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

/**
 * Whether a payment grant is bounded enough to auto-approve without a human.
 * On-chain spend requires an explicit amount ceiling: a per-spend `max` on
 * `amount.value`, or a daily amount limit. That is the floor that closes the
 * unbounded-spend hole; a recipient allowlist (`in`/`eq` on recipient) is an
 * optional tightening still enforced by the normal constraint check, but it is
 * not required because a shopping agent legitimately pays many merchants. An
 * amount-unbounded payment grant must fall through to manual CIBA.
 */
function isBoundedPaymentGrant(grant: NormalizedGrant): boolean {
  return (
    grant.dailyLimitAmount !== undefined ||
    grant.constraints.some(
      (constraint) =>
        constraint.field === "amount.value" && constraint.op === "max"
    )
  );
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
  // The spend whose amount the daily-amount ledger limit tracks: a
  // payment_authorization grant or a legacy purchase, whichever is present.
  const spend = authorizationDetails.find(
    (detail) =>
      detail.type === PAYMENT_AUTHORIZATION_TYPE || detail.type === "purchase"
  );
  const spendAmount = spend?.amount?.value
    ? Number.parseFloat(spend.amount.value)
    : undefined;

  for (const grant of activeGrants) {
    // A payment_authorization:sign grant authorizes on-chain spend. Never
    // auto-approve one that is not explicitly bounded: an empty-constraint /
    // no-limit grant would auto-approve any amount to any recipient. Require a
    // recipient allowlist AND an amount ceiling; otherwise fall through to
    // manual CIBA approval.
    if (
      capabilityName === PAYMENT_AUTHORIZATION_CAPABILITY &&
      !isBoundedPaymentGrant(grant)
    ) {
      continue;
    }

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
        amount: spendAmount,
        currency: spend?.amount?.currency,
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

// ---------------------------------------------------------------------------
// Usage ledger: enforces daily_limit_count, daily_limit_amount, cooldown_sec
// ---------------------------------------------------------------------------

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

interface UsageLimits {
  cooldownSec?: number | undefined;
  dailyLimitAmount?: number | undefined;
  dailyLimitCount?: number | undefined;
}

interface UsageEntry {
  amount?: number | undefined;
  capabilityName: string;
  currency?: string | undefined;
  grantId?: string | undefined;
  hostPolicyId?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
  sessionId: string;
}

function usageScopePredicate(entry: UsageEntry) {
  if (entry.hostPolicyId) {
    return eq(capabilityUsageLedger.hostPolicyId, entry.hostPolicyId);
  }
  if (entry.grantId) {
    return eq(capabilityUsageLedger.grantId, entry.grantId);
  }
  return eq(capabilityUsageLedger.sessionId, entry.sessionId);
}

function recordUsageIfAllowed(
  entry: UsageEntry,
  limits: UsageLimits
): Promise<boolean> {
  const now = Date.now();

  return db.transaction(async (tx) => {
    const scopePredicate = usageScopePredicate(entry);

    if (limits.cooldownSec) {
      const cooldownThreshold = new Date(now - limits.cooldownSec * 1000);
      const lastExecution = await tx
        .select({ executedAt: capabilityUsageLedger.executedAt })
        .from(capabilityUsageLedger)
        .where(
          and(
            eq(capabilityUsageLedger.capabilityName, entry.capabilityName),
            scopePredicate,
            gte(capabilityUsageLedger.executedAt, cooldownThreshold)
          )
        )
        .orderBy(sql`${capabilityUsageLedger.executedAt} DESC`)
        .limit(1)
        .get();

      if (lastExecution) {
        return false;
      }
    }

    const dayStart = new Date(now - ONE_DAY_MS);
    if (limits.dailyLimitCount) {
      const currentCount = await tx
        .select({ count: sql<number>`count(*)` })
        .from(capabilityUsageLedger)
        .where(
          and(
            eq(capabilityUsageLedger.capabilityName, entry.capabilityName),
            scopePredicate,
            gte(capabilityUsageLedger.executedAt, dayStart)
          )
        )
        .get();

      if ((currentCount?.count ?? 0) >= limits.dailyLimitCount) {
        return false;
      }
    }

    if (limits.dailyLimitAmount !== undefined && entry.amount !== undefined) {
      const currentAmount = await tx
        .select({
          totalAmount: sql<number>`coalesce(sum(${capabilityUsageLedger.amount}), 0)`,
        })
        .from(capabilityUsageLedger)
        .where(
          and(
            eq(capabilityUsageLedger.capabilityName, entry.capabilityName),
            scopePredicate,
            gte(capabilityUsageLedger.executedAt, dayStart)
          )
        )
        .get();

      if (
        (currentAmount?.totalAmount ?? 0) + entry.amount >
        limits.dailyLimitAmount
      ) {
        return false;
      }
    }

    await tx.insert(capabilityUsageLedger).values({
      capabilityName: entry.capabilityName,
      hostPolicyId: entry.hostPolicyId,
      grantId: entry.grantId,
      sessionId: entry.sessionId,
      amount: entry.amount,
      currency: entry.currency,
      metadata: entry.metadata ? JSON.stringify(entry.metadata) : undefined,
      executedAt: new Date(now),
    });

    return true;
  });
}
