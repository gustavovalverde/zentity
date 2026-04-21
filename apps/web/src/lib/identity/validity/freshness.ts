import "server-only";

import type { VerificationMethod } from "@/lib/db/schema/identity";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

interface FreshnessPolicy {
  maxVerificationAgeDays: number;
  warningThresholdDays: number;
}

const DEFAULT_FRESHNESS_POLICY: FreshnessPolicy = {
  maxVerificationAgeDays: 365,
  warningThresholdDays: 30,
};

function getFreshnessPolicyForMethod(
  _method: VerificationMethod
): FreshnessPolicy {
  return DEFAULT_FRESHNESS_POLICY;
}

export function computeFreshnessDeadline(args: {
  method: VerificationMethod;
  verifiedAt: string;
}): string {
  const policy = getFreshnessPolicyForMethod(args.method);
  const verifiedAt = new Date(args.verifiedAt);

  return new Date(
    verifiedAt.getTime() + policy.maxVerificationAgeDays * MS_PER_DAY
  ).toISOString();
}

export function isFreshnessExpired(
  freshnessDeadline: string | null,
  now: string
): boolean {
  if (!freshnessDeadline) {
    return false;
  }

  return new Date(freshnessDeadline).getTime() <= new Date(now).getTime();
}
