import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/lib/db/connection";
import { revokeIdentity } from "@/lib/db/queries/identity";
import { oidc4vciIssuedCredentials } from "@/lib/db/schema/oidc4vci";

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

/**
 * Admin individual credential revocation — revokes a single OID4VCI
 * credential without triggering the full identity revocation cascade.
 */
export const revokeCredentialProcedure = adminProcedure
  .input(
    z.object({
      credentialId: z.string().min(1),
    })
  )
  .mutation(async ({ input }) => {
    const credential = await db
      .select({
        id: oidc4vciIssuedCredentials.id,
        status: oidc4vciIssuedCredentials.status,
      })
      .from(oidc4vciIssuedCredentials)
      .where(eq(oidc4vciIssuedCredentials.id, input.credentialId))
      .limit(1)
      .get();

    if (!credential) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Credential not found",
      });
    }

    if (credential.status === 1) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "Credential already revoked",
      });
    }

    await db
      .update(oidc4vciIssuedCredentials)
      .set({
        status: 1,
        revokedAt: new Date(),
      })
      .where(eq(oidc4vciIssuedCredentials.id, input.credentialId))
      .run();

    return { revoked: true };
  });
