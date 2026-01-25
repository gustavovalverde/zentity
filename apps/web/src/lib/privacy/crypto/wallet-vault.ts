"use client";

import "client-only";

import { base64ToBytes, bytesToBase64 } from "@/lib/utils/base64";

import { encodeAad, WRAP_AAD_CONTEXT } from "./aad";
import { decryptAesGcm, encryptAesGcm } from "./aes-gcm";
import { deriveKekFromWalletSignature } from "./key-derivation";
import {
  decryptSecretWithDek,
  type EnvelopeFormat,
  parseWrappedDek,
  serializeWrappedDek,
  type WrappedDekPayload,
} from "./passkey-vault";

export const WALLET_CREDENTIAL_PREFIX = "wallet";

/** Salt length for wallet address commitments (32 bytes = 256 bits) */
const WALLET_COMMITMENT_SALT_LENGTH = 32;

/** Regex to strip 0x prefix from addresses */
const ADDRESS_PREFIX_REGEX = /^0x/;

const textEncoder = new TextEncoder();

/**
 * Normalize a wallet address to lowercase without 0x prefix.
 * Ensures consistent hashing regardless of input format.
 */
function normalizeAddress(address: string): string {
  return address.toLowerCase().replace(ADDRESS_PREFIX_REGEX, "");
}

/**
 * Generate a random salt for wallet address commitment.
 * Each commitment should use a unique salt to prevent correlation.
 */
export function generateWalletCommitmentSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(WALLET_COMMITMENT_SALT_LENGTH));
}

/**
 * Compute a privacy-preserving commitment to a wallet address.
 *
 * The commitment is SHA-256(address || salt) which:
 * - Hides the wallet address (can't be reversed)
 * - Is unlinkable across different salts (same address, different commitments)
 * - Can be verified if you know address + salt
 *
 * Used in BBS+ credentials to prove wallet ownership without revealing address.
 *
 * @param address - Ethereum wallet address (with or without 0x prefix)
 * @param salt - Random salt (should be unique per credential)
 * @returns SHA-256 hash as Uint8Array (32 bytes)
 */
export async function computeWalletCommitment(
  address: string,
  salt: Uint8Array
): Promise<Uint8Array> {
  const normalizedAddress = normalizeAddress(address);
  const addressBytes = textEncoder.encode(normalizedAddress);

  // Concatenate address bytes and salt
  const combined = new Uint8Array(addressBytes.length + salt.length);
  combined.set(addressBytes);
  combined.set(salt, addressBytes.length);

  const hashBuffer = await crypto.subtle.digest("SHA-256", combined);
  return new Uint8Array(hashBuffer);
}

/**
 * Verify a wallet address commitment.
 *
 * @param address - Claimed wallet address
 * @param salt - Salt used when creating the commitment
 * @param commitment - The commitment to verify
 * @returns true if the commitment matches
 */
export async function verifyWalletCommitment(
  address: string,
  salt: Uint8Array,
  commitment: Uint8Array
): Promise<boolean> {
  const computed = await computeWalletCommitment(address, salt);
  if (computed.length !== commitment.length) {
    return false;
  }
  // Constant-time comparison to prevent timing attacks
  let result = 0;
  for (let i = 0; i < computed.length; i++) {
    // biome-ignore lint/suspicious/noBitwiseOperators: constant-time comparison requires XOR
    result |= computed[i] ^ commitment[i];
  }
  return result === 0;
}

/**
 * Convert wallet commitment to hex string for storage/transmission.
 */
export function walletCommitmentToHex(commitment: Uint8Array): string {
  return Array.from(commitment)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Convert hex string back to wallet commitment bytes.
 */
export function hexToWalletCommitment(hex: string): Uint8Array {
  const cleanHex = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(cleanHex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
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
 * IMPORTANT: This message must be DETERMINISTIC to ensure the user can
 * regenerate the same KEK after cache expiration. Unlike passkey PRF
 * (deterministic for same salt) or OPAQUE (deterministic for same password),
 * wallet signatures are only reproducible if the signed message is identical.
 *
 * The message includes:
 * - userId: Binds the signature to a specific user (prevents cross-user attacks)
 * - purpose: Human-readable purpose for wallet UI
 *
 * The domain includes:
 * - name: Application name
 * - chainId: Network identifier (prevents cross-chain replay)
 * - verifyingContract: Zero address (no on-chain verification needed)
 *
 * NOTE: We intentionally exclude timestamp/validityDays to ensure the same
 * wallet + userId + chainId always produces the same signature and KEK.
 * This allows key recovery after browser restart or cache expiration.
 */
export interface WalletKekEIP712TypedData {
  domain: {
    name: string;
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
  const aad = encodeAad([
    WRAP_AAD_CONTEXT,
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
    WRAP_AAD_CONTEXT,
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
 * This cache is for UX convenience only (avoids repeated wallet popups).
 * Unlike previous implementations, the cache is NOT required for key recovery
 * because the EIP-712 message is deterministic. If the cache expires, the user
 * simply re-signs the same message to regenerate the same KEK.
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
 * Check if wallet signature cache is fresh without retrieving the signature.
 * Used to verify cache validity before starting multi-step verification flows.
 */
export function isWalletCacheFresh(
  userId: string,
  address: string,
  chainId: number
): boolean {
  return getCachedWalletSignature(userId, address, chainId) !== null;
}

/**
 * Clear the cached wallet signature.
 * Call on sign-out or when user explicitly disconnects wallet.
 */
export function resetWalletSignatureCache(): void {
  cachedWalletSignature = null;
}
