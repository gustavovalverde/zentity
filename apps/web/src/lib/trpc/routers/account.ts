/**
 * Account Management Router
 *
 * Handles account-level operations like fetching user data and account deletion.
 * Implements GDPR-compliant data erasure.
 */
import "server-only";

import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { auth } from "@/lib/auth/auth";
import { db } from "@/lib/db/connection";
import { deleteBlockchainAttestationsByUserId } from "@/lib/db/queries/attestation";
import { getUserCreatedAt, userHasPassword } from "@/lib/db/queries/auth";
import {
  deleteIdentityData,
  getSelectedIdentityDocumentByUserId,
  getVerificationStatus,
} from "@/lib/db/queries/identity";
import { passkeys } from "@/lib/db/schema/auth";

import { protectedProcedure, router } from "../server";

export const accountRouter = router({
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

    // Get verification status
    const verification = await getVerificationStatus(userId);

    // Get latest verified document details
    const document = await getSelectedIdentityDocumentByUserId(userId);

    // Get user creation date from better-auth user table
    const createdAt = await getUserCreatedAt(userId);

    // Check if user has a password set (for Change vs Set password UI)
    const hasPassword = await userHasPassword(userId);

    return {
      email: session.user.email,
      createdAt,
      hasPassword,
      verification: {
        level: verification.level,
        checks: verification.checks,
      },
      documentType: document?.documentType ?? null,
      countryVerified: document?.issuerCountry ?? null,
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
      const { userId, session } = ctx;

      // Verify email matches to prevent accidental deletion
      if (
        input.confirmEmail.toLowerCase() !== session.user.email.toLowerCase()
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Email confirmation does not match your account email",
        });
      }

      // Execute deletion in order:
      // 1. Delete identity attestation data (removes salts/commitments)
      await deleteIdentityData(userId);

      // 2. Delete blockchain attestation records
      await deleteBlockchainAttestationsByUserId(userId);

      // 3. Delete user from better-auth (cascades to sessions, accounts)
      // This also invalidates the current session
      let result: { success?: boolean } | null = null;
      try {
        result = await auth.api.deleteUser({
          headers: ctx.req.headers,
          body: {},
        });
      } catch (error) {
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
