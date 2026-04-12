import { and, eq, gte, sql } from "drizzle-orm";

import { db } from "@/lib/db/connection";
import { capabilityUsageLedger } from "@/lib/db/schema/agent";

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

export function recordUsageIfAllowed(
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
