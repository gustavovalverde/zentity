import { and, eq, inArray, isNotNull } from "drizzle-orm";

import { db } from "../connection";
import { accounts, users } from "../schema/auth";
import { identityVerificationDrafts } from "../schema/identity";
import { onboardingSessions } from "../schema/onboarding";

export async function getUserCreatedAt(userId: string): Promise<string | null> {
  const row = await db
    .select({ createdAt: users.createdAt })
    .from(users)
    .where(eq(users.id, userId))
    .get();

  return row?.createdAt ?? null;
}

/**
 * Check if a user has a credential account with a password set.
 * Users who signed up with passkey-only or OAuth won't have a password.
 */
export async function userHasPassword(userId: string): Promise<boolean> {
  const row = await db
    .select({ registrationRecord: accounts.registrationRecord })
    .from(accounts)
    .where(
      and(
        eq(accounts.userId, userId),
        eq(accounts.providerId, "opaque"),
        isNotNull(accounts.registrationRecord)
      )
    )
    .get();

  return !!row?.registrationRecord && row.registrationRecord.length > 0;
}

/**
 * Delete an incomplete signup (anonymous, unverified user) and all related records.
 *
 * This enables idempotent signups: if a user's previous signup attempt failed
 * midway, they can retry with the same email by deleting the incomplete state.
 *
 * Cascade behavior:
 * - Most tables (sessions, accounts, passkeys, zkProofs, etc.) cascade on user delete
 * - identityVerificationDrafts has onDelete: "set null" - requires manual cleanup
 * - onboardingSessions references drafts, not users - requires manual cleanup
 *
 * Passkey note: If a passkey was registered before failure, deleting the user
 * cascade-deletes the server-side passkey record. The client-side credential
 * remains in the authenticator but becomes orphaned. On retry, a new user ID
 * is generated, so WebAuthn sees it as a different user and allows creating
 * a fresh credential. The orphaned credential is harmless but not automatically
 * cleaned from the authenticator.
 */
export async function deleteIncompleteSignup(userId: string): Promise<void> {
  // 1. Find all identity drafts for this user (needed for onboarding session cleanup)
  const drafts = await db
    .select({ id: identityVerificationDrafts.id })
    .from(identityVerificationDrafts)
    .where(eq(identityVerificationDrafts.userId, userId))
    .all();

  const draftIds = drafts.map((d) => d.id);

  // 2. Delete onboarding sessions that reference these drafts
  if (draftIds.length > 0) {
    await db
      .delete(onboardingSessions)
      .where(inArray(onboardingSessions.identityDraftId, draftIds))
      .run();
  }

  // 3. Delete identity verification drafts (not cascaded, uses set null)
  await db
    .delete(identityVerificationDrafts)
    .where(eq(identityVerificationDrafts.userId, userId))
    .run();

  // 4. Delete the user - cascades to:
  //    - sessions, accounts, passkeys (auth)
  //    - zkProofs, encryptedAttributes, signedClaims, encryptedSecrets, secretWrappers (crypto)
  //    - identityBundles, identityDocuments, identityVerificationJobs (identity)
  //    - attestationEvidence, attestationState (attestation)
  //    - recoveryConfigs, recoveryRequests, guardianRelationships, pendingGuardianInvites (recovery)
  await db.delete(users).where(eq(users.id, userId)).run();
}
