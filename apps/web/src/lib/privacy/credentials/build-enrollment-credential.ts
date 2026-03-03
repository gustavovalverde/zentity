"use client";

import type { EnrollmentCredential } from "../secrets/types";
import type { CachedBindingMaterial } from "./cache";

/**
 * Reconstruct a full EnrollmentCredential from cached binding material.
 * Used by both OCR (liveness) and NFC chip verification flows
 * to store the profile secret after verification completes.
 */
export function buildEnrollmentCredential(
  cached: CachedBindingMaterial,
  userId: string,
  wallet: { address: string; chainId: number } | null
): EnrollmentCredential | null {
  if (cached.mode === "passkey") {
    return {
      type: "passkey",
      context: {
        credentialId: cached.credentialId,
        userId,
        prfOutput: cached.prfOutput,
        prfSalt: cached.prfSalt,
      },
    };
  }
  if (cached.mode === "opaque") {
    return {
      type: "opaque",
      context: { userId, exportKey: cached.exportKey },
    };
  }
  if (cached.mode === "wallet" && wallet) {
    return {
      type: "wallet",
      context: {
        userId,
        address: wallet.address,
        chainId: wallet.chainId,
        signatureBytes: cached.signatureBytes,
        signedAt: Math.floor(Date.now() / 1000),
        expiresAt: Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60,
      },
    };
  }
  return null;
}
