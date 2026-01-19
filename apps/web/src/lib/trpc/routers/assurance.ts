/**
 * Assurance Router
 *
 * Provides assurance state data for tier-based UI.
 * Uses React.cache() for per-request deduplication.
 */
import "server-only";

import type { FeatureName } from "@/lib/assurance/types";

import {
  getAssuranceState,
  getUnauthenticatedAssuranceState,
} from "@/lib/assurance/data";
import { canAccessFeature, getBlockedReason } from "@/lib/assurance/features";

import { protectedProcedure, publicProcedure, router } from "../server";

export const assuranceRouter = router({
  /**
   * Get current user's assurance state
   *
   * Returns:
   * - tier: 0-2
   * - tierName: "Anonymous" | "Account" | "Verified"
   * - authStrength: "basic" | "strong"
   * - details: breakdown of verification checks
   */
  profile: protectedProcedure.query(async ({ ctx }) => {
    return await getAssuranceState(ctx.userId, ctx.session);
  }),

  /**
   * Get assurance state for potentially unauthenticated users
   *
   * Returns Tier 0 state for unauthenticated users,
   * or the real state for authenticated users.
   */
  publicProfile: publicProcedure.query(({ ctx }) => {
    if (!ctx.session?.user?.id) {
      return getUnauthenticatedAssuranceState();
    }
    return getAssuranceState(ctx.session.user.id, ctx.session);
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
      const state = await getAssuranceState(ctx.userId, ctx.session);
      const accessible = canAccessFeature(
        input,
        state.tier,
        state.authStrength
      );

      return {
        feature: input,
        accessible,
        currentTier: state.tier,
        authStrength: state.authStrength,
        blockedReason: accessible
          ? null
          : getBlockedReason(input, state.tier, state.authStrength),
      };
    }),
});
