import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { revokeIdentity } from "@/lib/db/queries/identity";

import { protectedProcedure } from "../../server";

/**
 * Admin revocation — revokes a user's identity with a reason.
 * The caller must be authenticated (protectedProcedure enforces session).
 *
 * In production this would be role-gated to admin users; for now any
 * authenticated user can trigger revocation on their own identity via
 * selfRevoke, while this procedure is intended for admin use.
 */
export const revokeProcedure = protectedProcedure
  .input(
    z.object({
      userId: z.string().min(1),
      reason: z.string().min(1).max(500),
    })
  )
  .mutation(async ({ ctx, input }) => {
    const result = await revokeIdentity(
      input.userId,
      ctx.session.user.email ?? ctx.session.user.id,
      input.reason
    );
    return result;
  });

/**
 * User self-revocation — users can revoke their own identity (GDPR).
 */
export const selfRevokeProcedure = protectedProcedure
  .input(
    z.object({
      reason: z.string().min(1).max(500),
    })
  )
  .mutation(async ({ ctx, input }) => {
    const userId = ctx.session.user.id;
    if (!userId) {
      throw new TRPCError({ code: "UNAUTHORIZED" });
    }
    const result = await revokeIdentity(userId, "self", input.reason);
    return result;
  });
