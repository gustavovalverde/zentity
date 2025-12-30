export const HKDF_INFO = {
  PASSKEY_KEK: "zentity-passkey-kek-v1",
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
 */
export async function deriveKekFromPrf(
  prfOutput: Uint8Array,
  info: string = HKDF_INFO.PASSKEY_KEK,
): Promise<CryptoKey> {
  const masterKey = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(prfOutput),
    "HKDF",
    false,
    ["deriveKey"],
  );

  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      salt: new Uint8Array(0),
      hash: "SHA-256",
      info: new TextEncoder().encode(info),
    },
    masterKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}
