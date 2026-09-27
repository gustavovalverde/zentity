import "server-only";

import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db/connection";
import { getPrimaryWalletAddress } from "@/lib/db/queries/auth";
import {
  getEncryptedSecretByUserAndType,
  getSecretWrappersBySecretId,
} from "@/lib/db/queries/privacy";
import { accounts, passkeys } from "@/lib/db/schema/auth";

import {
  OPAQUE_CREDENTIAL_ID,
  RECOVERY_KEY_CREDENTIAL_ID,
  VAULT_ROOT_SECRET_TYPE,
} from "./catalog";

export interface VaultAccess {
  passkeys: Array<{
    connected: boolean;
    createdAt: string;
    credentialId: string;
    id: string;
    name: string | null;
  }>;
  password: { connected: boolean } | null;
  recoveryKey: { createdAt: string } | null;
  secretId: string;
  /** Sign-in credentials plus the recovery key that can open the vault. */
  unlockingCount: number;
  wallet: { address: string; chainId: number; connected: boolean } | null;
}

function walletCredentialId(wallet: { address: string; chainId: number }) {
  return `wallet:${wallet.chainId}:${wallet.address}`.toLowerCase();
}

function hasWalletWrapper(
  wrapperIds: Set<string>,
  wallet: { address: string; chainId: number }
): boolean {
  const expected = walletCredentialId(wallet);
  return [...wrapperIds].some((id) => id.toLowerCase() === expected);
}

/**
 * Which of the user's credentials can open their vault. Returns null when
 * the user has no vault yet.
 */
export async function getVaultAccess(
  userId: string
): Promise<VaultAccess | null> {
  const root = await getEncryptedSecretByUserAndType(
    userId,
    VAULT_ROOT_SECRET_TYPE
  );
  if (!root) {
    return null;
  }

  const [wrappers, passkeyRows, opaqueAccount, wallet] = await Promise.all([
    getSecretWrappersBySecretId(root.id),
    db
      .select({
        id: passkeys.id,
        credentialId: passkeys.credentialID,
        name: passkeys.name,
        createdAt: passkeys.createdAt,
      })
      .from(passkeys)
      .where(eq(passkeys.userId, userId))
      .all(),
    db
      .select({ id: accounts.id })
      .from(accounts)
      .where(
        and(eq(accounts.userId, userId), eq(accounts.providerId, "opaque"))
      )
      .limit(1)
      .get(),
    getPrimaryWalletAddress(userId),
  ]);

  const wrapperIds = new Set(wrappers.map((w) => w.credentialId));
  const recoveryWrapper = wrappers.find(
    (w) => w.credentialId === RECOVERY_KEY_CREDENTIAL_ID
  );

  const access: VaultAccess = {
    secretId: root.id,
    passkeys: passkeyRows.map((row) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
      connected: wrapperIds.has(row.credentialId),
    })),
    password: opaqueAccount
      ? { connected: wrapperIds.has(OPAQUE_CREDENTIAL_ID) }
      : null,
    wallet: wallet
      ? { ...wallet, connected: hasWalletWrapper(wrapperIds, wallet) }
      : null,
    recoveryKey: recoveryWrapper
      ? { createdAt: recoveryWrapper.updatedAt }
      : null,
    unlockingCount: 0,
  };

  access.unlockingCount =
    access.passkeys.filter((p) => p.connected).length +
    (access.password?.connected ? 1 : 0) +
    (access.wallet?.connected ? 1 : 0) +
    (access.recoveryKey ? 1 : 0);

  return access;
}
