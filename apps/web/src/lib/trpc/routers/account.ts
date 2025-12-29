/**
 * Account Management Router
 *
 * Handles account-level operations like fetching user data and account deletion.
 * Implements GDPR-compliant data erasure.
 */
import "server-only";

import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { deleteBlockchainAttestationsByUserId } from "@/lib/db/queries/attestation";
import { deleteUserById, getUserCreatedAt } from "@/lib/db/queries/auth";
import {
  deleteIdentityData,
  getSelectedIdentityDocumentByUserId,
  getUserFirstName,
  getVerificationStatus,
} from "@/lib/db/queries/identity";
import { deleteOnboardingSession } from "@/lib/db/queries/onboarding";

import { protectedProcedure, router } from "../server";

export const accountRouter = router({
  /**
   * Get current user's account data for display
   */
  getData: protectedProcedure.query(async ({ ctx }) => {
    const { userId, session } = ctx;

    // Get first name (decrypted)
    const firstName = await getUserFirstName(userId);

    // Get verification status
    const verification = getVerificationStatus(userId);

    // Get latest verified document details
    const document = getSelectedIdentityDocumentByUserId(userId);

    // Get user creation date from better-auth user table
    const createdAt = getUserCreatedAt(userId);

    return {
      email: session.user.email,
      firstName,
      createdAt,
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
   * - Any orphaned onboarding sessions
   */
  deleteAccount: protectedProcedure
    .input(
      z.object({
        confirmEmail: z.string().email(),
      }),
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
      deleteIdentityData(userId);

      // 2. Delete blockchain attestation records
      deleteBlockchainAttestationsByUserId(userId);

      // 3. Clean up any orphaned onboarding sessions
      deleteOnboardingSession(session.user.email);

      // 4. Delete user from better-auth (cascades to sessions, accounts)
      // This also invalidates the current session
      deleteUserById(userId);

      return { success: true };
    }),
});
