"use client";

/**
 * Resolve the currently cached enrollment credential.
 *
 * Checks OPAQUE, wallet, and passkey caches (populated during FHE enrollment)
 * and returns an EnrollmentCredential if any are available.
 * Returns null if no credential material is cached.
 */

import type { EnrollmentCredential } from "@/lib/privacy/secrets/types";

import { authClient } from "@/lib/auth/auth-client";

import {
  getCachedOpaqueExportKey,
  getCachedPasskeyUnlock,
  hasAnyCachedOpaqueExport,
} from "./cache";
import { generatePrfSalt } from "./derivation";
import { getCachedWalletContext } from "./wallet";

export async function resolveEnrollmentCredential(): Promise<EnrollmentCredential | null> {
  const session = await authClient.getSession();
  const userId = session.data?.user?.id;
  if (!userId) {
    return null;
  }

  // Check OPAQUE cache (most common for password users)
  if (hasAnyCachedOpaqueExport()) {
    const exportKey = getCachedOpaqueExportKey(userId);
    if (exportKey) {
      return { type: "opaque", context: { userId, exportKey } };
    }
  }

  // Check wallet cache
  const walletCtx = getCachedWalletContext();
  if (walletCtx && walletCtx.userId === userId) {
    return {
      type: "wallet",
      context: {
        userId,
        address: walletCtx.address,
        chainId: walletCtx.chainId,
        signatureBytes: walletCtx.signatureBytes,
        signedAt: walletCtx.signedAt,
        expiresAt: walletCtx.expiresAt,
      },
    };
  }

  // Check passkey cache — use a generic credential ID list since we
  // don't know which passkeys are registered for secrets
  const { data: passkeys } = await authClient.passkey.listUserPasskeys();
  if (passkeys?.length) {
    const credentialIds = passkeys.map(
      (p: { credentialID: string }) => p.credentialID
    );
    const cached = getCachedPasskeyUnlock(credentialIds);
    if (cached) {
      return {
        type: "passkey",
        context: {
          credentialId: cached.credentialId,
          userId,
          prfOutput: cached.prfOutput,
          prfSalt: generatePrfSalt(),
        },
      };
    }
  }

  return null;
}
