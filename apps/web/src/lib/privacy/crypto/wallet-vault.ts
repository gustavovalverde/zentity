"use client";

import "client-only";

import { base64ToBytes, bytesToBase64 } from "@/lib/utils/base64";

import { decryptAesGcm, encryptAesGcm } from "./aes-gcm";
import { deriveKekFromWalletSignature, KEK_SOURCE } from "./key-derivation";
import {
  decryptSecretWithDek,
  type EnvelopeFormat,
  parseWrappedDek,
  serializeWrappedDek,
  WRAP_AAD_VERSION,
  WRAP_VERSION,
  type WrappedDekPayload,
} from "./passkey-vault";

export const WALLET_CREDENTIAL_PREFIX = "wallet";

const textEncoder = new TextEncoder();

function encodeAad(parts: string[]): Uint8Array {
  return textEncoder.encode(parts.join("|"));
}

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
 * Parse a wallet credential ID back to its components.
 * Returns null if the format is invalid.
 */
export function parseWalletCredentialId(
  credentialId: string
): { address: string; chainId: number } | null {
  if (!credentialId.startsWith(WALLET_CREDENTIAL_PREFIX)) {
    return null;
  }
  const parts = credentialId.split(":");
  if (parts.length !== 3) {
    return null;
  }
  const chainId = Number.parseInt(parts[1], 10);
  if (Number.isNaN(chainId)) {
    return null;
  }
  return { chainId, address: parts[2] };
}

/**
 * EIP-712 typed data structure for KEK derivation signature.
 *
 * The message includes:
 * - userId: Binds the signature to a specific user (prevents cross-user attacks)
 * - purpose: Human-readable purpose for wallet UI
 * - timestamp: When the signature was requested
 * - validityDays: How long the signature is valid (for user awareness)
 *
 * The domain includes:
 * - name: Application name
 * - version: Protocol version (for future upgrades)
 * - chainId: Network identifier (prevents cross-chain replay)
 * - verifyingContract: Zero address (no on-chain verification needed)
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
    timestamp: bigint;
    validityDays: bigint;
  };
}

/**
 * Build EIP-712 typed data for KEK derivation signature.
 *
 * This creates a deterministic message that:
 * 1. Is human-readable in wallet UI (shows purpose, validity)
 * 2. Binds the signature to a specific user and chain
 * 3. Produces the same signature when signed with the same wallet (deterministic)
 */
export function buildKekSignatureTypedData(params: {
  userId: string;
  chainId: number;
  timestamp: number;
  validityDays: number;
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
        { name: "timestamp", type: "uint256" },
        { name: "validityDays", type: "uint256" },
      ],
    },
    primaryType: "KeyDerivation",
    message: {
      userId: params.userId,
      purpose: "Zentity Encryption Key Derivation",
      timestamp: BigInt(params.timestamp),
      validityDays: BigInt(params.validityDays),
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
 * - Protocol version (prevents version confusion attacks)
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
  const aad = encodeAad([
    WRAP_AAD_VERSION,
    params.secretId,
    credentialId,
    params.userId,
  ]);
  const kek = await deriveKekFromWalletSignature(
    params.signatureBytes,
    params.userId
  );
  const wrapped = await encryptAesGcm(kek, params.dek, aad);

  const payload: WrappedDekPayload = {
    version: WRAP_VERSION,
    alg: "AES-GCM",
    iv: bytesToBase64(wrapped.iv),
    ciphertext: bytesToBase64(wrapped.ciphertext),
  };

  return serializeWrappedDek(payload);
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
  const payload = parseWrappedDek(params.wrappedDek);
  const aad = encodeAad([
    WRAP_AAD_VERSION,
    params.secretId,
    credentialId,
    params.userId,
  ]);
  const kek = await deriveKekFromWalletSignature(
    params.signatureBytes,
    params.userId
  );

  return decryptAesGcm(
    kek,
    {
      iv: base64ToBytes(payload.iv),
      ciphertext: base64ToBytes(payload.ciphertext),
    },
    aad
  );
}

/**
 * Create a wallet wrapper for an existing secret.
 * Used when a user adds wallet auth to an existing passkey/OPAQUE account.
 *
 * Returns the wrapper data needed for storage in secret_wrappers table.
 */
export async function createWalletWrapper(params: {
  secretId: string;
  userId: string;
  address: string;
  chainId: number;
  dek: Uint8Array;
  signatureBytes: Uint8Array;
  signedAt: number;
  expiresAt: number;
}): Promise<{
  wrappedDek: string;
  credentialId: string;
  kekSource: typeof KEK_SOURCE.WALLET;
  kekVersion: string;
  metadata: {
    address: string;
    chainId: number;
    signedAt: number;
    expiresAt: number;
  };
}> {
  const wrappedDek = await wrapDekWithWalletSignature({
    secretId: params.secretId,
    userId: params.userId,
    address: params.address,
    chainId: params.chainId,
    dek: params.dek,
    signatureBytes: params.signatureBytes,
  });

  return {
    wrappedDek,
    credentialId: getWalletCredentialId({
      address: params.address,
      chainId: params.chainId,
    }),
    kekSource: KEK_SOURCE.WALLET,
    kekVersion: WRAP_VERSION,
    metadata: {
      address: params.address,
      chainId: params.chainId,
      signedAt: params.signedAt,
      expiresAt: params.expiresAt,
    },
  };
}

/**
 * Decrypt a secret envelope using wallet signature-derived KEK.
 * This mirrors decryptSecretEnvelope from passkey-vault but uses wallet signature.
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

  return decryptSecretWithDek({
    secretId: params.secretId,
    secretType: params.secretType,
    encryptedBlob: params.encryptedBlob,
    dek,
    envelopeFormat: params.envelopeFormat,
  });
}

/**
 * Session cache for wallet signatures.
 *
 * Unlike passkey PRF (which requires authenticator interaction each time),
 * wallet signatures can be cached in memory to avoid repeated signature prompts.
 *
 * Security considerations:
 * - In-memory only (cleared on page refresh/tab close)
 * - TTL-based expiration (default 24 hours)
 * - Validated against current user/address/chain
 */
interface CachedWalletSignature {
  userId: string;
  address: string;
  chainId: number;
  signatureBytes: Uint8Array;
  signedAt: number;
  expiresAt: number;
  cachedAt: number;
}

const WALLET_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
let cachedWalletSignature: CachedWalletSignature | null = null;

/**
 * Cache a wallet signature for session-based reuse.
 */
export function cacheWalletSignature(params: {
  userId: string;
  address: string;
  chainId: number;
  signatureBytes: Uint8Array;
  signedAt: number;
  expiresAt: number;
}): void {
  cachedWalletSignature = {
    ...params,
    cachedAt: Date.now(),
  };
}

/**
 * Retrieve a cached wallet signature if valid.
 *
 * Returns null if:
 * - No cached signature exists
 * - Cache has expired (TTL or signature expiry)
 * - User/address/chain doesn't match
 */
export function getCachedWalletSignature(
  userId: string,
  address: string,
  chainId: number
): Uint8Array | null {
  if (!cachedWalletSignature) {
    return null;
  }

  const now = Date.now();

  // Check TTL expiration
  if (now - cachedWalletSignature.cachedAt > WALLET_CACHE_TTL_MS) {
    cachedWalletSignature = null;
    return null;
  }

  // Check signature expiration
  if (now >= cachedWalletSignature.expiresAt * 1000) {
    cachedWalletSignature = null;
    return null;
  }

  // Validate user/address/chain match
  if (
    cachedWalletSignature.userId !== userId ||
    cachedWalletSignature.address.toLowerCase() !== address.toLowerCase() ||
    cachedWalletSignature.chainId !== chainId
  ) {
    return null;
  }

  return cachedWalletSignature.signatureBytes;
}

/**
 * Clear the cached wallet signature.
 * Call on sign-out or when user explicitly disconnects wallet.
 */
export function resetWalletSignatureCache(): void {
  cachedWalletSignature = null;
}
