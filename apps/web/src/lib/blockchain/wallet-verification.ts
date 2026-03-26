import "server-only";

import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db/connection";
import { accounts, walletAddresses } from "@/lib/db/schema/auth";

/**
 * Verifies that a wallet address is associated with the given user.
 * Checks both the wallet_address table (SIWE registrations) and the
 * accounts table (wallet-based OAuth logins).
 */
export async function verifyWalletOwnership(
  userId: string,
  walletAddress: string
): Promise<boolean> {
  const normalizedAddress = walletAddress.toLowerCase();

  // Check wallet_address table (SIWE-registered wallets)
  const walletRow = await db
    .select({ id: walletAddresses.id })
    .from(walletAddresses)
    .where(eq(walletAddresses.userId, userId))
    .limit(10)
    .all();

  for (const row of walletRow) {
    // walletAddresses stores mixed-case; compare lowercased
    const wa = await db
      .select({ address: walletAddresses.address })
      .from(walletAddresses)
      .where(eq(walletAddresses.id, row.id))
      .get();
    if (wa && wa.address.toLowerCase() === normalizedAddress) {
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

  return false;
}
