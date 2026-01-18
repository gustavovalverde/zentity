/**
 * Assurance Router
 *
 * Provides tier profile data for progressive tier UI.
 * Uses React.cache() for per-request deduplication.
 */
import "server-only";

import type { FeatureName } from "@/lib/assurance/types";

import {
  getTierProfile,
  getUnauthenticatedTierProfile,
} from "@/lib/assurance/data";
import { isFeatureUnlocked } from "@/lib/assurance/tier";

import { protectedProcedure, publicProcedure, router } from "../server";

export const assuranceRouter = router({
  /**
   * Get current user's tier profile
   *
   * Returns:
   * - tier: 0-3
   * - aal: 0-2
   * - label: Human-readable tier name
   * - nextTierRequirements: Steps to advance (null if at max)
   */
  profile: protectedProcedure.query(async ({ ctx }) => {
    const profile = await getTierProfile(ctx.userId, ctx.session);
    return profile;
  }),

  /**
   * Get tier profile for potentially unauthenticated users
   *
   * Returns Tier 0 profile for unauthenticated users,
   * or the real profile for authenticated users.
   */
  publicProfile: publicProcedure.query(({ ctx }) => {
    if (!ctx.session?.user?.id) {
      return getUnauthenticatedTierProfile();
    }
    return getTierProfile(ctx.session.user.id, ctx.session);
  }),

  /**
   * Check if a specific feature is accessible
   *
   * Useful for client-side feature gating before navigating.
   */
  checkFeature: protectedProcedure
    .input((val) => {
      if (typeof val !== "string") {
        throw new Error("Feature name must be a string");
      }
      return val as FeatureName;
    })
    .query(async ({ ctx, input }) => {
      const profile = await getTierProfile(ctx.userId, ctx.session);
      const unlocked = isFeatureUnlocked(input, profile.tier, profile.aal);

      return {
        feature: input,
        unlocked,
        currentTier: profile.tier,
        currentAAL: profile.aal,
      };
    }),
});
