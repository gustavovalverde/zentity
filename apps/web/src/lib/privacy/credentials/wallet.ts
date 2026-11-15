"use client";

import "client-only";

/**
 * Wallet Credential Module
 *
 * Identifies wallet credentials and builds the deterministic EIP-712 message
 * whose signature is the wallet's KEK input, so the same wallet reproduces
 * the same KEK across sessions.
 */

export const WALLET_CREDENTIAL_PREFIX = "wallet";

/**
 * Generate a deterministic credential ID from wallet address and chain ID.
 * Format: "wallet:{chainId}:{checksummedAddress}"
 *
 * This ensures unique credential IDs per wallet per chain while maintaining
 * consistency across sessions (same wallet always produces same credentialId).
 */
export function getWalletCredentialId(params: {
  address: string;
  chainId: number;
}): string {
  return `${WALLET_CREDENTIAL_PREFIX}:${params.chainId}:${params.address}`;
}

/**
 * EIP-712 typed data structure for KEK derivation signature.
 *
 * IMPORTANT: This message must be DETERMINISTIC to ensure the user can
 * regenerate the same KEK after cache expiration.
 */
interface WalletKekEIP712TypedData {
  domain: {
    name: string;
    version: string;
    chainId: number;
    verifyingContract: `0x${string}`;
  };
  message: {
    userId: string;
    purpose: string;
  };
  primaryType: "KeyDerivation";
  types: {
    KeyDerivation: Array<{ name: string; type: string }>;
  };
}

/**
 * Build EIP-712 typed data for KEK derivation signature.
 *
 * This creates a DETERMINISTIC message that:
 * 1. Is human-readable in wallet UI (shows purpose)
 * 2. Binds the signature to a specific user and chain
 * 3. Produces the SAME signature when signed with the same wallet
 *
 * CRITICAL: The message must be identical across sessions to regenerate
 * the same KEK. Never include timestamps or other session-varying data.
 */
export function buildKekSignatureTypedData(params: {
  userId: string;
  chainId: number;
}): WalletKekEIP712TypedData {
  return {
    domain: {
      name: "Zentity",
      version: "1",
      chainId: params.chainId,
      verifyingContract: "0x0000000000000000000000000000000000000000",
    },
    types: {
      KeyDerivation: [
        { name: "userId", type: "string" },
        { name: "purpose", type: "string" },
      ],
    },
    primaryType: "KeyDerivation",
    message: {
      userId: params.userId,
      purpose: "Zentity Encryption Key Derivation",
    },
  };
}
