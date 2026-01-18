import { revalidateTag } from "next/cache";

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
