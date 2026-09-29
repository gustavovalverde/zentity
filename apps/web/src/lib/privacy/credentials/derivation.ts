/**
 * KEK Derivation Module
 *
 * Derives Key Encryption Keys (KEKs) from credential materials using HKDF.
 * Each credential type (passkey PRF, OPAQUE export key, wallet signature,
 * recovery key) and the vault key itself use domain-separated HKDF info
 * strings to prevent cross-protocol attacks. Every KEK is bound to the user
 * through the HKDF salt.
 */

import { toArrayBuffer } from "@/lib/privacy/primitives/symmetric";

const HKDF_INFO = {
  PASSKEY_KEK: "zentity:kek:passkey",
  OPAQUE_KEK: "zentity:kek:opaque",
  WALLET_KEK: "zentity:kek:wallet",
  RECOVERY_KEY_KEK: "zentity:kek:recovery-key",
  VAULT_KEK: "zentity:kek:vault",
} as const;

/**
 * Generate a random PRF salt (32 bytes).
 */
export function generatePrfSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}

async function deriveAesKek(params: {
  ikm: Uint8Array;
  userId: string;
  info: string;
  salt?: Uint8Array | undefined;
  expected?: { length: number; label: string };
}): Promise<CryptoKey> {
  if (!params.userId) {
    throw new Error("userId is required for KEK derivation.");
  }
  if (params.expected && params.ikm.byteLength !== params.expected.length) {
    throw new Error(
      `${params.expected.label} must be ${params.expected.length} bytes, got ${params.ikm.byteLength}`
    );
  }
  const salt = params.salt ?? new TextEncoder().encode(params.userId);
  if (salt.byteLength === 0) {
    throw new Error("HKDF salt must not be empty.");
  }

  const masterKey = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(params.ikm),
    "HKDF",
    false,
    ["deriveKey"]
  );

  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      salt: toArrayBuffer(salt),
      hash: "SHA-256",
      info: new TextEncoder().encode(params.info),
    },
    masterKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

/**
 * Derive a non-extractable AES-256-GCM key from PRF output.
 * The passkey's PRF salt is the HKDF salt when provided; the userId otherwise.
 */
export function deriveKekFromPrf(
  prfOutput: Uint8Array,
  userId: string,
  info: string = HKDF_INFO.PASSKEY_KEK,
  hkdfSalt?: Uint8Array
): Promise<CryptoKey> {
  return deriveAesKek({ ikm: prfOutput, userId, info, salt: hkdfSalt });
}

/**
 * Derive a KEK from the 64-byte OPAQUE export key.
 */
export function deriveKekFromOpaqueExport(
  exportKey: Uint8Array,
  userId: string,
  info: string = HKDF_INFO.OPAQUE_KEK
): Promise<CryptoKey> {
  return deriveAesKek({
    ikm: exportKey,
    userId,
    info,
    expected: { length: 64, label: "OPAQUE export key" },
  });
}

/**
 * Derive a KEK from a deterministic 65-byte EIP-712 wallet signature.
 */
export function deriveKekFromWalletSignature(
  signatureBytes: Uint8Array,
  userId: string,
  info: string = HKDF_INFO.WALLET_KEK
): Promise<CryptoKey> {
  return deriveAesKek({
    ikm: signatureBytes,
    userId,
    info,
    expected: { length: 65, label: "Wallet signature" },
  });
}

/**
 * Derive a KEK from the 32-byte recovery key entropy.
 */
export function deriveKekFromRecoveryKey(
  recoveryKey: Uint8Array,
  userId: string
): Promise<CryptoKey> {
  return deriveAesKek({
    ikm: recoveryKey,
    userId,
    info: HKDF_INFO.RECOVERY_KEY_KEK,
    expected: { length: 32, label: "Recovery key" },
  });
}

/**
 * Derive the KEK that wraps every non-root vault secret from the vault key
 * (the DEK of the root secret).
 */
export function deriveKekFromVaultKey(
  vaultKey: Uint8Array,
  userId: string
): Promise<CryptoKey> {
  return deriveAesKek({
    ikm: vaultKey,
    userId,
    info: HKDF_INFO.VAULT_KEK,
    expected: { length: 32, label: "Vault key" },
  });
}
