import { and, desc, eq, isNotNull } from "drizzle-orm";
import { cache } from "react";
import { getAddress } from "viem";

import { db } from "../connection";
import { accounts, users, walletAddresses } from "../schema/auth";

/**
 * Updates a user's email, derives a display name from the local part,
 * and clears the anonymous flag.
 *
 * Uses raw Drizzle instead of better-auth's API because:
 * - `auth.api.updateUser()` explicitly blocks email changes
 * - `auth.api.changeEmail()` requires an email verification flow
 * - `setSessionCookie()` (which refreshes the cookie cache) is only
 *   available inside better-auth endpoint contexts, not tRPC mutations
 *
 * Callers must invalidate the session_data cookie cache after calling this
 * so the dashboard reads fresh data (see `invalidateSessionDataCache()`).
 */
export async function updateUserEmail(
  userId: string,
  email: string
): Promise<void> {
  const localPart = email.split("@")[0];
  const name = localPart.replaceAll(/[._+-]+/g, " ").trim() || localPart;

  await db
    .update(users)
    .set({
      email,
      name,
      isAnonymous: false,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(users.id, userId))
    .run();
}

/**
 * Clears the anonymous flag without changing email/name.
 * Used when a user completes sign-up without providing an email.
 * Same raw-Drizzle constraint as `updateUserEmail` — see its JSDoc.
 */
export async function clearAnonymousFlag(userId: string): Promise<void> {
  await db
    .update(users)
    .set({
      isAnonymous: false,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(users.id, userId))
    .run();
}

export const getUserCreatedAt = cache(async function getUserCreatedAt(
  userId: string
): Promise<string | null> {
  const row = await db
    .select({ createdAt: users.createdAt })
    .from(users)
    .where(eq(users.id, userId))
    .get();

  return row?.createdAt ?? null;
});

/**
 * Check if a user has a credential account with a password set.
 * Users who signed up with passkey-only or OAuth won't have a password.
 */
export const userHasPassword = cache(async function userHasPassword(
  userId: string
): Promise<boolean> {
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
});

/**
 * Delete an incomplete signup (anonymous, unverified user) and all related records.
 *
 * This enables idempotent signups: if a user's previous signup attempt failed
 * midway, they can retry with the same email by deleting the incomplete state.
 *
 * Cascade behavior:
 * - Most tables (sessions, accounts, passkeys, zkProofs, etc.) cascade on user delete
 * - identityVerificationDrafts cascades on user delete
 *
 * Passkey note: If a passkey was registered before failure, deleting the user
 * cascade-deletes the server-side passkey record. The client-side credential
 * remains in the authenticator but becomes orphaned. On retry, a new user ID
 * is generated, so WebAuthn sees it as a different user and allows creating
 * a fresh credential. The orphaned credential is harmless but not automatically
 * cleaned from the authenticator.
 */
export async function deleteIncompleteSignup(userId: string): Promise<void> {
  // Delete the user - cascades to:
  //    - sessions, accounts, passkeys (auth)
  //    - zkProofs, encryptedAttributes, signedClaims, encryptedSecrets, secretWrappers (crypto)
  //    - identityBundles, identityDocuments, identityVerificationJobs (identity)
  //    - attestationEvidence, attestationState (attestation)
  //    - recoveryConfigs, recoveryRequests, guardianRelationships, pendingGuardianInvites (recovery)
  await db.delete(users).where(eq(users.id, userId)).run();
}

/**
 * Links a wallet address to a user account.
 *
 * Called during wallet-based sign-up to store the wallet address in the
 * wallet_address table. This is critical for SIWE sign-in: without this link,
 * the user would get a new account on their next login attempt, making their
 * FHE keys inaccessible.
 *
 * Uses INSERT OR IGNORE to handle idempotent calls (unique constraint on
 * address + chainId prevents duplicates).
 *
 * @param params.userId - The user ID to link the wallet to
 * @param params.address - The Ethereum wallet address (checksummed or lowercase)
 * @param params.chainId - The chain ID where the signature was made
 * @param params.isPrimary - Whether this is the user's primary wallet (default: true for first wallet)
 */
export async function linkWalletAddress(params: {
  userId: string;
  address: string;
  chainId: number;
  isPrimary?: boolean;
}): Promise<void> {
  const { userId, address, chainId, isPrimary = true } = params;

  // Use checksum address format to match better-auth SIWE plugin lookups
  const normalizedAddress = getAddress(address);

  await db
    .insert(walletAddresses)
    .values({
      userId,
      address: normalizedAddress,
      chainId,
      isPrimary,
    })
    .onConflictDoNothing()
    .run();
}

export async function getPrimaryWalletAddress(userId: string): Promise<{
  address: string;
  chainId: number;
} | null> {
  const row = await db
    .select({
      address: walletAddresses.address,
      chainId: walletAddresses.chainId,
      isPrimary: walletAddresses.isPrimary,
      createdAt: walletAddresses.createdAt,
    })
    .from(walletAddresses)
    .where(eq(walletAddresses.userId, userId))
    .orderBy(desc(walletAddresses.isPrimary), desc(walletAddresses.createdAt))
    .limit(1)
    .get();

  if (!row) {
    return null;
  }

  return { address: row.address, chainId: row.chainId };
}
