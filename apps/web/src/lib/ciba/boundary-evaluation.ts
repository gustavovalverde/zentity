import { and, eq, gte, sql } from "drizzle-orm";

import { isIdentityScope } from "@/lib/auth/oidc/identity-scopes";
import { db } from "@/lib/db/connection";
import { agentBoundaries } from "@/lib/db/schema/agent-boundaries";
import { cibaRequests } from "@/lib/db/schema/ciba";

interface PurchaseConfig {
  cooldownMinutes: number;
  currency: string;
  dailyCap: number;
  maxAmount: number;
}

interface ScopeConfig {
  allowedScopes: string[];
}

interface CustomConfig {
  actionType: string;
  dailyCount: number;
}

interface AuthorizationDetail {
  amount?: { currency?: string; value?: string };
  type?: string;
  [key: string]: unknown;
}

export type BoundaryConfig = PurchaseConfig | ScopeConfig | CustomConfig;

export interface EvaluationResult {
  autoApproved: boolean;
  reason?: string;
}

/**
 * Evaluate all boundaries for a CIBA request. Returns autoApproved: true
 * only if at least one boundary matches AND all applicable boundaries pass.
 *
 * Identity-scoped requests always return autoApproved: false.
 */
export async function evaluateBoundaries(
  userId: string,
  clientId: string,
  scope: string,
  authorizationDetails: string | null
): Promise<EvaluationResult> {
  const scopes = scope.split(" ").filter(Boolean);

  if (scopes.some(isIdentityScope)) {
    return {
      autoApproved: false,
      reason: "identity scopes require manual approval",
    };
  }

  const boundaries = await db
    .select()
    .from(agentBoundaries)
    .where(
      and(
        eq(agentBoundaries.userId, userId),
        eq(agentBoundaries.clientId, clientId),
        eq(agentBoundaries.enabled, true)
      )
    )
    .all();

  if (boundaries.length === 0) {
    return { autoApproved: false, reason: "no boundaries configured" };
  }

  const details = parseAuthorizationDetails(authorizationDetails);

  for (const boundary of boundaries) {
    const config = JSON.parse(boundary.config) as BoundaryConfig;
    const result = await evaluateSingleBoundary(
      boundary.boundaryType,
      config,
      scopes,
      details,
      userId,
      clientId
    );
    if (!result.pass) {
      return { autoApproved: false, reason: result.reason };
    }
  }

  return { autoApproved: true };
}

function parseAuthorizationDetails(raw: string | null): AuthorizationDetail[] {
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

interface SingleResult {
  pass: boolean;
  reason?: string;
}

async function evaluateSingleBoundary(
  type: string,
  config: BoundaryConfig,
  scopes: string[],
  details: AuthorizationDetail[],
  userId: string,
  clientId: string
): Promise<SingleResult> {
  switch (type) {
    case "purchase":
      return await evaluatePurchaseBoundary(
        config as PurchaseConfig,
        details,
        userId,
        clientId
      );
    case "scope":
      return evaluateScopeBoundary(config as ScopeConfig, scopes);
    case "custom":
      return await evaluateCustomBoundary(
        config as CustomConfig,
        details,
        userId,
        clientId
      );
    default:
      return { pass: false, reason: `unknown boundary type: ${type}` };
  }
}

async function evaluatePurchaseBoundary(
  config: PurchaseConfig,
  details: AuthorizationDetail[],
  userId: string,
  clientId: string
): Promise<SingleResult> {
  const purchase = details.find((d) => d.type === "purchase");
  if (!purchase?.amount?.value) {
    return { pass: true };
  }

  const amount = Number.parseFloat(purchase.amount.value);
  if (Number.isNaN(amount)) {
    return { pass: false, reason: "invalid purchase amount" };
  }

  const currency = purchase.amount.currency ?? "USD";
  if (currency !== config.currency) {
    return {
      pass: false,
      reason: `currency mismatch: ${currency} vs ${config.currency}`,
    };
  }

  if (amount > config.maxAmount) {
    return {
      pass: false,
      reason: `amount ${amount} exceeds max ${config.maxAmount}`,
    };
  }

  const dailyTotal = await getDailyBoundaryApprovedTotal(userId, clientId);
  if (dailyTotal + amount > config.dailyCap) {
    return {
      pass: false,
      reason: `daily cap would be exceeded (${dailyTotal + amount} > ${config.dailyCap})`,
    };
  }

  const lastApproval = await getLastBoundaryApprovalTime(userId, clientId);
  if (lastApproval) {
    const cooldownMs = config.cooldownMinutes * 60 * 1000;
    if (Date.now() - lastApproval.getTime() < cooldownMs) {
      return { pass: false, reason: "cooldown period active" };
    }
  }

  return { pass: true };
}

function evaluateScopeBoundary(
  config: ScopeConfig,
  scopes: string[]
): SingleResult {
  const nonStandard = scopes.filter((s) => s !== "openid");
  const disallowed = nonStandard.filter(
    (s) => !config.allowedScopes.includes(s)
  );
  if (disallowed.length > 0) {
    return {
      pass: false,
      reason: `disallowed scopes: ${disallowed.join(", ")}`,
    };
  }
  return { pass: true };
}

async function evaluateCustomBoundary(
  config: CustomConfig,
  details: AuthorizationDetail[],
  userId: string,
  clientId: string
): Promise<SingleResult> {
  const matching = details.filter((d) => d.type === config.actionType);
  if (matching.length === 0) {
    return { pass: true };
  }

  const dailyCount = await getDailyBoundaryApprovedCount(userId, clientId);
  if (dailyCount + 1 > config.dailyCount) {
    return {
      pass: false,
      reason: `daily count exceeded (${dailyCount + 1} > ${config.dailyCount})`,
    };
  }

  return { pass: true };
}

/**
 * Sum of purchase amounts boundary-approved in the last 24h.
 * Tracked via `approvalMethod = "boundary"` on the cibaRequests table.
 */
async function getDailyBoundaryApprovedTotal(
  userId: string,
  clientId: string
): Promise<number> {
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const rows = await db
    .select({ authorizationDetails: cibaRequests.authorizationDetails })
    .from(cibaRequests)
    .where(
      and(
        eq(cibaRequests.userId, userId),
        eq(cibaRequests.clientId, clientId),
        eq(cibaRequests.approvalMethod, "boundary"),
        gte(cibaRequests.createdAt, oneDayAgo)
      )
    )
    .all();

  let total = 0;
  for (const row of rows) {
    const details = parseAuthorizationDetails(row.authorizationDetails);
    const purchase = details.find((d) => d.type === "purchase");
    if (purchase?.amount?.value) {
      total += Number.parseFloat(purchase.amount.value) || 0;
    }
  }
  return total;
}

async function getDailyBoundaryApprovedCount(
  userId: string,
  clientId: string
): Promise<number> {
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const result = await db
    .select({ count: sql<number>`count(*)` })
    .from(cibaRequests)
    .where(
      and(
        eq(cibaRequests.userId, userId),
        eq(cibaRequests.clientId, clientId),
        eq(cibaRequests.approvalMethod, "boundary"),
        gte(cibaRequests.createdAt, oneDayAgo)
      )
    )
    .get();

  return result?.count ?? 0;
}

async function getLastBoundaryApprovalTime(
  userId: string,
  clientId: string
): Promise<Date | null> {
  const row = await db
    .select({ createdAt: cibaRequests.createdAt })
    .from(cibaRequests)
    .where(
      and(
        eq(cibaRequests.userId, userId),
        eq(cibaRequests.clientId, clientId),
        eq(cibaRequests.approvalMethod, "boundary")
      )
    )
    .orderBy(sql`${cibaRequests.createdAt} DESC`)
    .limit(1)
    .get();

  return row?.createdAt ?? null;
}
