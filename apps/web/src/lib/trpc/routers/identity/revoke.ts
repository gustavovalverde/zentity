import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { revokeIdentity } from "@/lib/db/queries/identity";

import { adminProcedure, protectedProcedure } from "../../server";

/**
 * Admin revocation — revokes a user's identity with a reason.
 * Only users with the "admin" role can call this procedure.
 */
export const revokeProcedure = adminProcedure
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
