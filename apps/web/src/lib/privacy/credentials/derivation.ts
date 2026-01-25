/**
 * KEK Derivation Module
 *
 * Derives Key Encryption Keys (KEKs) from credential materials using HKDF.
 * Each credential type (passkey PRF, OPAQUE export key, wallet signature)
 * uses domain-separated HKDF info strings to prevent cross-protocol attacks.
 */

const HKDF_INFO = {
  PASSKEY_KEK: "zentity:kek:passkey",
  OPAQUE_KEK: "zentity:kek:opaque",
  WALLET_KEK: "zentity:kek:wallet",
} as const;

export const KEK_SOURCE = {
  PRF: "prf",
  OPAQUE: "opaque",
  WALLET: "wallet",
  RECOVERY: "recovery",
} as const;

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}

/**
 * Generate a random PRF salt (32 bytes).
 */
export function generatePrfSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}

/**
 * Derive a non-extractable AES-256-GCM key from PRF output using HKDF.
 * The userId is used as HKDF salt to bind the KEK to a specific user.
 */
export async function deriveKekFromPrf(
  prfOutput: Uint8Array,
  userId: string,
  info: string = HKDF_INFO.PASSKEY_KEK
): Promise<CryptoKey> {
  if (!userId) {
    throw new Error("userId is required for KEK derivation.");
  }
  const masterKey = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(prfOutput),
    "HKDF",
    false,
    ["deriveKey"]
  );

  const salt = new TextEncoder().encode(userId);

  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      salt,
      hash: "SHA-256",
      info: new TextEncoder().encode(info),
    },
    masterKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

/**
 * Derive a non-extractable AES-256-GCM key from OPAQUE export key using HKDF.
 * The export key is 64 bytes of high-entropy material derived from the
 * OPAQUE protocol, providing equivalent security to passkey PRF output.
 * The userId is used as HKDF salt to bind the KEK to a specific user.
 */
export async function deriveKekFromOpaqueExport(
  exportKey: Uint8Array,
  userId: string,
  info: string = HKDF_INFO.OPAQUE_KEK
): Promise<CryptoKey> {
  if (!userId) {
    throw new Error("userId is required for KEK derivation.");
  }
  if (exportKey.byteLength !== 64) {
    throw new Error(
      `OPAQUE export key must be 64 bytes, got ${exportKey.byteLength}`
    );
  }

  const masterKey = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(exportKey),
    "HKDF",
    false,
    ["deriveKey"]
  );

  const salt = new TextEncoder().encode(userId);

  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      salt,
      hash: "SHA-256",
      info: new TextEncoder().encode(info),
    },
    masterKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

/**
 * Derive a non-extractable AES-256-GCM key from wallet EIP-712 signature using HKDF.
 *
 * The signature provides 65 bytes (520 bits) of high-entropy material from ECDSA.
 * We use the userId as salt to ensure different users derive different KEKs even
 * if they somehow produce the same signature (which shouldn't happen, but defense in depth).
 *
 * Security properties:
 * - Deterministic: Same signature + userId always produces the same KEK
 * - Non-extractable: Key cannot be exported from WebCrypto
 * - Purpose-bound: Uses "zentity:kek:wallet" info to prevent cross-protocol attacks
 * - User-bound: userId in salt prevents cross-user key reuse
 */
export async function deriveKekFromWalletSignature(
  signatureBytes: Uint8Array,
  userId: string,
  info: string = HKDF_INFO.WALLET_KEK
): Promise<CryptoKey> {
  if (signatureBytes.byteLength !== 65) {
    throw new Error(
      `Wallet signature must be 65 bytes, got ${signatureBytes.byteLength}`
    );
  }

  const masterKey = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(signatureBytes),
    "HKDF",
    false,
    ["deriveKey"]
  );

  const salt = new TextEncoder().encode(userId);

  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      salt,
      hash: "SHA-256",
      info: new TextEncoder().encode(info),
    },
    masterKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}
