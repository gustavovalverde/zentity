/**
 * Account Management Router
 *
 * Handles account-level operations like fetching user data and account deletion.
 * Implements GDPR-compliant data erasure.
 */
import "server-only";

import { TRPCError } from "@trpc/server";
import { isAPIError } from "better-auth/api";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { auth } from "@/lib/auth/auth-config";
import { getRecoveryOptions } from "@/lib/auth/recovery-factors";
import { db } from "@/lib/db/connection";
import { getUserCreatedAt, userHasPassword } from "@/lib/db/queries/auth";
import { passkeys } from "@/lib/db/schema/auth";
import { getVerificationReadModel } from "@/lib/identity/verification/read-model";

import {
  protectedProcedure,
  requireRecoveryFactorChange,
  router,
} from "../server";

export const accountRouter = router({
  /**
   * What this session can still prove toward account recovery, and whether
   * it may add a passkey now. Reveals nothing before sign-in.
   */
  recoveryOptions: protectedProcedure.query(({ ctx }) =>
    getRecoveryOptions({
      sessionId:
        ctx.authenticatedWith === "session_cookie"
          ? ctx.session.session.id
          : null,
      userId: ctx.userId,
    })
  ),

  /**
   * Check if user has any registered passkeys.
   * Used to determine if "Unlock with Passkey" UI should be shown.
   */
  hasPasskeys: protectedProcedure.query(async ({ ctx }) => {
    const result = await db
      .select({ id: passkeys.id })
      .from(passkeys)
      .where(eq(passkeys.userId, ctx.userId))
      .limit(1)
      .get();
    return { hasPasskeys: !!result };
  }),

  /**
   * Get current user's account data for display
   */
  getData: protectedProcedure.query(async ({ ctx }) => {
    const { userId, session } = ctx;

    const [verificationModel, createdAt, hasPassword] = await Promise.all([
      getVerificationReadModel(userId),
      getUserCreatedAt(userId),
      userHasPassword(userId),
    ]);

    return {
      email: session.user.email,
      createdAt,
      hasPassword,
      verification: {
        identity: verificationModel.compliance.identity,
        humanity: verificationModel.compliance.humanity,
        policy: verificationModel.compliance.policy,
        verificationExpiresAt: verificationModel.bundle.verificationExpiresAt,
        validityStatus: verificationModel.bundle.validityStatus,
      },
      humanityCredentials: verificationModel.humanityCredentials,
      groupedIdentity: verificationModel.groupedIdentity,
      documentVerified: verificationModel.groupedIdentity.credentials.some(
        (credential) =>
          credential.isEffective && credential.status === "verified"
      ),
    };
  }),

  /**
   * Delete user account (GDPR right to erasure)
   *
   * This permanently deletes all user data including:
   * - Identity proofs (salt, commitments - makes all data unlinkable)
   * - Age proofs (ZK proofs, FHE ciphertexts)
   * - User account (cascades to sessions, linked accounts)
   */
  deleteAccount: protectedProcedure
    .input(
      z.object({
        confirmEmail: z.email(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { session } = ctx;

      // Verify email matches to prevent accidental deletion
      if (
        input.confirmEmail.toLowerCase() !== session.user.email.toLowerCase()
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Email confirmation does not match your account email",
        });
      }

      await requireRecoveryFactorChange(ctx, "account_deletion");

      // Better Auth erases identity and attestation data in `beforeDelete`,
      // then deletes the user, its sessions, and its accounts.
      let result: { success?: boolean } | null = null;
      try {
        result = await auth.api.deleteUser({
          headers: ctx.req.headers,
          body: {},
        });
      } catch (error) {
        if (isAPIError(error) && error.body?.code === "SESSION_EXPIRED") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Sign in again, then delete your account.",
          });
        }
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error
              ? error.message
              : "Failed to delete account. Please try again.",
        });
      }

      if (!result?.success) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to delete account. Please try again.",
        });
      }

      return { success: true };
    }),
});
