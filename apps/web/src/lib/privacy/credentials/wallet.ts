"use client";

import "client-only";

/**
 * Wallet Credential Module
 *
 * Handles wallet signature-based KEK derivation and DEK wrapping.
 * Uses EIP-712 typed data signatures with deterministic message structure
 * to ensure reproducible KEK derivation across sessions.
 */

import type { EnvelopeFormat } from "@/lib/privacy/secrets/types";

import { decryptWithDek } from "@/lib/privacy/secrets/envelope";

import { deriveKekFromWalletSignature } from "./derivation";
import { unwrapDek, wrapDek } from "./wrap";

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
export interface WalletKekEIP712TypedData {
  domain: {
    name: string;
    version: string;
    chainId: number;
    verifyingContract: `0x${string}`;
  };
  types: {
    KeyDerivation: Array<{ name: string; type: string }>;
  };
  primaryType: "KeyDerivation";
  message: {
    userId: string;
    purpose: string;
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

/**
 * Convert a hex signature string to Uint8Array.
 * Handles both 0x-prefixed and raw hex strings.
 */
export function signatureToBytes(signature: string): Uint8Array {
  const hex = signature.startsWith("0x") ? signature.slice(2) : signature;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Wrap a DEK using wallet signature-derived KEK.
 *
 * The AAD (Additional Authenticated Data) binds the wrapped DEK to:
 * - Secret ID (prevents key substitution attacks)
 * - Credential ID (identifies which wallet wrapped this)
 * - User ID (prevents cross-user key reuse)
 */
export async function wrapDekWithWalletSignature(params: {
  secretId: string;
  userId: string;
  address: string;
  chainId: number;
  dek: Uint8Array;
  signatureBytes: Uint8Array;
}): Promise<string> {
  const credentialId = getWalletCredentialId({
    address: params.address,
    chainId: params.chainId,
  });
  const kek = await deriveKekFromWalletSignature(
    params.signatureBytes,
    params.userId
  );
  return wrapDek({
    secretId: params.secretId,
    credentialId,
    userId: params.userId,
    dek: params.dek,
    kek,
  });
}

/**
 * Unwrap a DEK using wallet signature-derived KEK.
 *
 * The signature must match the one used during wrapping (same message = same signature = same KEK).
 */
export async function unwrapDekWithWalletSignature(params: {
  secretId: string;
  userId: string;
  address: string;
  chainId: number;
  wrappedDek: string;
  signatureBytes: Uint8Array;
}): Promise<Uint8Array> {
  const credentialId = getWalletCredentialId({
    address: params.address,
    chainId: params.chainId,
  });
  const kek = await deriveKekFromWalletSignature(
    params.signatureBytes,
    params.userId
  );
  return unwrapDek({
    secretId: params.secretId,
    credentialId,
    userId: params.userId,
    wrappedDek: params.wrappedDek,
    kek,
  });
}

/**
 * Decrypt a secret envelope using wallet signature-derived KEK.
 * Combines DEK unwrapping with envelope decryption.
 */
export async function decryptSecretWithWalletSignature(params: {
  secretId: string;
  secretType: string;
  userId: string;
  address: string;
  chainId: number;
  encryptedBlob: Uint8Array;
  wrappedDek: string;
  signatureBytes: Uint8Array;
  envelopeFormat: EnvelopeFormat;
}): Promise<Uint8Array> {
  const dek = await unwrapDekWithWalletSignature({
    secretId: params.secretId,
    userId: params.userId,
    address: params.address,
    chainId: params.chainId,
    wrappedDek: params.wrappedDek,
    signatureBytes: params.signatureBytes,
  });

  return decryptWithDek({
    secretId: params.secretId,
    secretType: params.secretType,
    encryptedBlob: params.encryptedBlob,
    dek,
    envelopeFormat: params.envelopeFormat,
  });
}
