import "server-only";

import {
  getIdentityValiditySnapshot,
  listExpiredIdentityBundles,
  recordIdentityFreshnessCheck,
} from "@/lib/db/queries/identity-validity";

import { recordValidityTransition } from "./transition";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MAX_VERIFICATION_AGE_DAYS = 365;

export function computeFreshnessDeadline(verifiedAt: string): string {
  return new Date(
    new Date(verifiedAt).getTime() + MAX_VERIFICATION_AGE_DAYS * MS_PER_DAY
  ).toISOString();
}

function isFreshnessExpired(
  freshnessDeadline: string | null,
  now: string
): boolean {
  if (!freshnessDeadline) {
    return false;
  }

  return new Date(freshnessDeadline).getTime() <= new Date(now).getTime();
}

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
