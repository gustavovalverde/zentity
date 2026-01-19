import { and, eq, isNotNull } from "drizzle-orm";

import { db } from "../connection";
import { accounts, users, walletAddresses } from "../schema/auth";

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

  // Normalize address to lowercase for consistent lookups
  const normalizedAddress = address.toLowerCase();

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
