import { revalidateTag, unstable_cache } from "next/cache";

import { getVerificationStatus } from "@/lib/db/queries/identity";

/**
 * Cached verification status with 5-minute TTL.
 * Uses unstable_cache with tag-based invalidation.
 */
export function getCachedVerificationStatus(userId: string) {
  return unstable_cache(
    () => getVerificationStatus(userId),
    [`user-verification-${userId}`],
    {
      revalidate: 300, // 5-minute TTL
      tags: [`user-verification-${userId}`],
    }
  )();
}

/**
 * Invalidate cached verification status for a user.
 * Call this after successful verification or proof storage.
 * Uses 'max' profile for stale-while-revalidate behavior.
 */
export function invalidateVerificationCache(userId: string) {
  try {
    revalidateTag(`user-verification-${userId}`, "max");
  } catch {
    // Ignore when running outside Next.js request/route context (tests, scripts).
  }
}
