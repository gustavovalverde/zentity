/**
 * Account Management Router
 *
 * Handles account-level operations like fetching user data and account deletion.
 * Implements GDPR-compliant data erasure.
 */
import "server-only";

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  deleteAgeProofs,
  deleteIdentityProof,
  deleteOnboardingSession,
  getIdentityProofByUserId,
  getUserFirstName,
  getVerificationStatus,
} from "@/lib/db";
import { getDefaultDatabasePath, getSqliteDb } from "@/lib/sqlite";
import { protectedProcedure, router } from "../server";

const db = getSqliteDb(getDefaultDatabasePath());

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

    // Get identity proof for additional data
    const proof = getIdentityProofByUserId(userId);

    // Get user creation date from better-auth user table
    const userRow = db
      .prepare(`SELECT "createdAt" FROM "user" WHERE id = ?`)
      .get(userId) as { createdAt: string } | undefined;

    return {
      email: session.user.email,
      firstName,
      createdAt: userRow?.createdAt ?? null,
      verification: {
        level: verification.level,
        checks: verification.checks,
      },
      documentType: proof?.documentType ?? null,
      countryVerified: proof?.countryVerified ?? null,
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
      // 1. Delete identity proofs (removes salt, making commitments unlinkable)
      deleteIdentityProof(userId);

      // 2. Delete age proofs (ZK proofs, FHE ciphertexts)
      deleteAgeProofs(userId);

      // 3. Clean up any orphaned onboarding sessions
      deleteOnboardingSession(session.user.email);

      // 4. Delete user from better-auth (cascades to sessions, accounts)
      // This also invalidates the current session
      const deleteUser = db.prepare(`DELETE FROM "user" WHERE id = ?`);
      deleteUser.run(userId);

      return { success: true };
    }),
});
