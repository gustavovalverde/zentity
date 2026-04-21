import "server-only";

import {
  getIdentityValiditySnapshot,
  listExpiredIdentityBundles,
  recordIdentityFreshnessCheck,
} from "@/lib/db/queries/identity-validity";

import { isFreshnessExpired } from "./freshness";
import { recordValidityTransition } from "./transition";

export async function markDueIdentitiesStale(
  args: { limit?: number; now?: string } = {}
): Promise<{
  evaluated: number;
  staleTransitionsCreated: number;
}> {
  const now = args.now ?? new Date().toISOString();
  const dueBundles = await listExpiredIdentityBundles({
    ...(args.limit === undefined ? {} : { limit: args.limit }),
    now,
  });

  let staleTransitionsCreated = 0;

  for (const bundle of dueBundles) {
    const snapshot = await getIdentityValiditySnapshot(bundle.userId);
    if (!snapshot || snapshot.validityStatus !== "verified") {
      continue;
    }

    if (!isFreshnessExpired(bundle.verificationExpiresAt, now)) {
      await recordIdentityFreshnessCheck({
        userId: bundle.userId,
        freshnessCheckedAt: now,
      });
      continue;
    }

    await recordValidityTransition({
      userId: bundle.userId,
      verificationId: bundle.effectiveVerificationId,
      eventKind: "stale",
      source: "system",
      occurredAt: now,
      reason: "verification_freshness_expired",
      bundleSnapshot: {
        effectiveVerificationId: snapshot.effectiveVerificationId ?? null,
        freshnessCheckedAt: now,
        verificationExpiresAt: bundle.verificationExpiresAt,
        validityStatus: "stale",
        revokedAt: snapshot.revokedAt,
        revokedBy: snapshot.revokedBy,
        revokedReason: snapshot.revokedReason,
      },
    });

    staleTransitionsCreated += 1;
  }

  return {
    evaluated: dueBundles.length,
    staleTransitionsCreated,
  };
}
