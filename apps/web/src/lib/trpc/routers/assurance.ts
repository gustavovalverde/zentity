/**
 * Assurance Router
 *
 * Provides assurance state data for tier-based UI.
 * Uses React.cache() for per-request deduplication.
 */
import "server-only";

import type { FeatureName } from "@/lib/assurance/types";

import {
  getSecurityPosture,
  getSecurityPostureForSession,
  getUnauthenticatedSecurityPosture,
} from "@/lib/assurance/data";
import { canAccessFeature, getBlockedReason } from "@/lib/assurance/features";

import { protectedProcedure, publicProcedure, router } from "../server";

export const assuranceRouter = router({
  /**
   * Get current user's security posture
   *
   * Returns account assurance, current auth context, and account capabilities.
   */
  profile: protectedProcedure.query(async ({ ctx }) => {
    return await getSecurityPosture({
      userId: ctx.userId,
      presentedAuth: {
        authContextId: ctx.authContext?.id ?? null,
        sessionId: ctx.session.session.id,
      },
    });
  }),

  /**
   * Get assurance state for potentially unauthenticated users
   *
   * Returns Tier 0 state for unauthenticated users,
   * or the real state for authenticated users.
   */
  publicProfile: publicProcedure.query(({ ctx }) => {
    if (!ctx.session?.user?.id) {
      return getUnauthenticatedSecurityPosture();
    }
    return getSecurityPostureForSession(ctx.session.user.id, ctx.session);
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
      const posture = await getSecurityPosture({
        userId: ctx.userId,
        presentedAuth: {
          authContextId: ctx.authContext?.id ?? null,
          sessionId: ctx.session.session.id,
        },
      });
      const accessible = canAccessFeature(
        input,
        posture.assurance.tier,
        posture.auth
      );

      return {
        feature: input,
        accessible,
        currentTier: posture.assurance.tier,
        auth: posture.auth,
        blockedReason: accessible
          ? null
          : getBlockedReason(input, posture.assurance.tier, posture.auth),
      };
    }),
});
