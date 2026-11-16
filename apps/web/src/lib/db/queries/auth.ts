import { and, desc, eq, isNotNull, lt, ne, or } from "drizzle-orm";
import { cache } from "react";
import { getAddress, isAddress } from "viem";

import { deletePairwiseSubjectsForUser } from "@/lib/auth/oidc/pairwise-subject-index";
import { WALLET_EMAIL_DOMAIN } from "@/lib/auth/synthetic-email";

import { db } from "../connection";
import { accounts, users, walletAddresses } from "../schema/auth";

/**
 * Updates a user's email, derives a display name from the local part,
 * marks the address unverified, and clears the anonymous flag.
 *
 * Uses raw Drizzle instead of better-auth's API because:
 * - `auth.api.updateUser()` explicitly blocks email changes
 * - `auth.api.changeEmail()` requires an email verification flow
 * - `setSessionCookie()` (which refreshes the cookie cache) is only
 *   available inside better-auth endpoint contexts, not tRPC mutations
 *
 * Callers must refresh the session_data cookie cache after calling this so
 * the dashboard reads fresh data, with
 * `authClient.getSession({ query: { disableCookieCache: true } })`.
 */
export async function updateUserEmail(
  userId: string,
  email: string
): Promise<void> {
  const localPart = email.split("@")[0] ?? email;
  const name = localPart.replaceAll(/[._+-]+/g, " ").trim() || localPart;

  await db
    .update(users)
    .set({
      email,
      name,
      emailVerified: false,
      isAnonymous: false,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId))
    .run();
}

/**
 * Updates a wallet user's identity: sets a wallet-derived email and
 * abbreviated address as display name, and clears the anonymous flag.
 * Same raw-Drizzle constraint as `updateUserEmail` — see its JSDoc.
 */
export async function updateUserWalletIdentity(
  userId: string,
  walletAddress: string
): Promise<void> {
  const checksummed = getAddress(walletAddress);
  const abbrev = `${checksummed.slice(0, 6)}...${checksummed.slice(-4)}`;
  const walletEmail = `${checksummed.toLowerCase().slice(2, 10)}@${WALLET_EMAIL_DOMAIN}`;

  await db
    .update(users)
    .set({
      email: walletEmail,
      name: abbrev,
      isAnonymous: false,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId))
    .run();
}

/**
 * Clears the anonymous flag without changing email/name.
 * Used when a user completes sign-up without providing an email (passkey path).
 * Same raw-Drizzle constraint as `updateUserEmail` — see its JSDoc.
 */
export async function clearAnonymousFlag(userId: string): Promise<void> {
  await db
    .update(users)
    .set({
      isAnonymous: false,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId))
    .run();
}

/** Whether the user is still anonymous, i.e. has not finished sign-up. */
export async function isUserAnonymous(userId: string): Promise<boolean> {
  const row = await db
    .select({ isAnonymous: users.isAnonymous })
    .from(users)
    .where(eq(users.id, userId))
    .get();
  return row?.isAnonymous === true;
}

export const getUserCreatedAt = cache(async function getUserCreatedAt(
  userId: string
): Promise<string | null> {
  const row = await db
    .select({ createdAt: users.createdAt })
    .from(users)
    .where(eq(users.id, userId))
    .get();

  return row?.createdAt ? row.createdAt.toISOString() : null;
});

/**
 * Check if a user has a password set via any provider that challenges
 * with one at sensitive endpoints, such as a password change.
 * Users who signed up with passkey-only or OAuth won't have a password.
 *
 * Covers both the OPAQUE provider (our PAKE flow, stores in
 * `registrationRecord`) and better-auth's built-in `credential` provider
 * (stores in `password`). Either presence means the user can be password-
 * challenged.
 */
export const userHasPassword = cache(async function userHasPassword(
  userId: string
): Promise<boolean> {
  const row = await db
    .select({
      providerId: accounts.providerId,
      registrationRecord: accounts.registrationRecord,
      password: accounts.password,
    })
    .from(accounts)
    .where(
      and(
        eq(accounts.userId, userId),
        or(
          and(
            eq(accounts.providerId, "opaque"),
            isNotNull(accounts.registrationRecord)
          ),
          and(
            eq(accounts.providerId, "credential"),
            isNotNull(accounts.password)
          )
        )
      )
    )
    .get();

  if (!row) {
    return false;
  }
  if (row.providerId === "opaque") {
    return Boolean(row.registrationRecord && row.registrationRecord.length > 0);
  }
  return Boolean(row.password && row.password.length > 0);
});

/**
 * Reaps anonymous users older than `maxAgeMs`. Cascades sessions, accounts,
 * passkeys, wallet addresses, etc. via FK `ON DELETE CASCADE`. Used by the
 * scheduled cleanup cron to keep orphaned sign-up state bounded.
 */
export async function deleteExpiredAnonymousUsers(
  maxAgeMs: number
): Promise<number> {
  const cutoff = new Date(Date.now() - maxAgeMs);
  const result = await db
    .delete(users)
    .where(and(eq(users.isAnonymous, true), lt(users.createdAt, cutoff)))
    .run();
  return result.rowsAffected ?? 0;
}

/**
 * Returns true if a non-anonymous user other than `excludeUserId` already
 * owns this email. Used by sign-up to detect collisions privately, before
 * any UPDATE that would surface a UNIQUE-constraint conflict.
 */
export async function emailBelongsToAnotherAccount(
  email: string,
  excludeUserId: string
): Promise<boolean> {
  const row = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.email, email),
        eq(users.isAnonymous, false),
        ne(users.id, excludeUserId)
      )
    )
    .limit(1)
    .get();
  return Boolean(row);
}

/**
 * Deletes any anonymous user rows that hold a given email, excluding the
 * current user. This cleans up stale rows from previous incomplete signup
 * attempts so the email can be reused without hitting a UNIQUE constraint.
 */
export async function deleteStaleAnonymousUserByEmail(
  email: string,
  excludeUserId: string
): Promise<void> {
  await db
    .delete(users)
    .where(
      and(
        eq(users.email, email),
        eq(users.isAnonymous, true),
        ne(users.id, excludeUserId)
      )
    )
    .run();
}

/**
 * Delete an incomplete signup (anonymous, unverified user) and all related records.
 *
 * This enables idempotent signups: if a user's previous signup attempt failed
 * midway, they can retry with the same email by deleting the incomplete state.
 *
 * Cascade behavior:
 * - Most tables (sessions, accounts, passkeys, proofArtifacts, etc.) cascade on user delete
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
  //    - proofArtifacts, encryptedAttributes, signedClaims, encryptedSecrets, secretWrappers (crypto)
  //    - identityBundles, identityVerifications, identityVerificationJobs (identity)
  //    - attestationEvidence, attestationState (attestation)
  await deletePairwiseSubjectsForUser(userId);
  await db.delete(users).where(eq(users.id, userId)).run();
}

/**
 * Whether the user's own sign-up linked this wallet. Only the Sign-In with
 * Ethereum sign-up (`/sign-up/siwe/complete`) writes a `wallet_address` row,
 * after it verifies the wallet's signatures, so a row proves the user
 * controls the address.
 */
export async function isWalletLinkedToUser(
  userId: string,
  address: string
): Promise<boolean> {
  if (!isAddress(address, { strict: false })) {
    return false;
  }
  const row = await db
    .select({ id: walletAddresses.id })
    .from(walletAddresses)
    .where(
      and(
        eq(walletAddresses.userId, userId),
        eq(walletAddresses.address, getAddress(address))
      )
    )
    .limit(1)
    .get();
  return Boolean(row);
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
