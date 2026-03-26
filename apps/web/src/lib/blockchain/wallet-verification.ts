import "server-only";

import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db/connection";
import { blockchainAttestations } from "@/lib/db/schema/attestation";
import { accounts, walletAddresses } from "@/lib/db/schema/auth";

/**
 * Verifies that a wallet address is associated with the given user.
 * Checks:
 * 1. wallet_address table (SIWE registrations)
 * 2. accounts table (wallet-based OAuth logins)
 * 3. blockchain_attestations table (wallets used for prior attestations)
 */
export async function verifyWalletOwnership(
  userId: string,
  walletAddress: string
): Promise<boolean> {
  const normalizedAddress = walletAddress.toLowerCase();

  // Check wallet_address table (SIWE-registered wallets)
  const walletRows = await db
    .select({ address: walletAddresses.address })
    .from(walletAddresses)
    .where(eq(walletAddresses.userId, userId))
    .all();

  for (const row of walletRows) {
    if (row.address.toLowerCase() === normalizedAddress) {
      return true;
    }
  }

  // Check accounts table for wallet-based auth (EIP-712 / SIWE provider)
  const accountRows = await db
    .select({ accountId: accounts.accountId })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.providerId, "eip712")))
    .all();

  for (const row of accountRows) {
    if (row.accountId.toLowerCase() === normalizedAddress) {
      return true;
    }
  }

  // Check blockchain_attestations for wallets previously used by this user
  const attestationRows = await db
    .select({ walletAddress: blockchainAttestations.walletAddress })
    .from(blockchainAttestations)
    .where(eq(blockchainAttestations.userId, userId))
    .all();

  for (const row of attestationRows) {
    if (row.walletAddress.toLowerCase() === normalizedAddress) {
      return true;
    }
  }

  return false;
}
