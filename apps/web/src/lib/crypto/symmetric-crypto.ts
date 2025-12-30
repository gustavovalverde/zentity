export interface EncryptedBlob {
  ciphertext: Uint8Array;
  iv: Uint8Array;
}

const AES_GCM_IV_BYTES = 12;

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}

/**
 * Generate a cryptographically secure IV for AES-GCM.
 * AES-GCM requires a unique IV per encryption with the same key.
 */
export function generateIv(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(AES_GCM_IV_BYTES));
}

export async function encryptAesGcm(
  key: CryptoKey,
  plaintext: Uint8Array,
  additionalData?: Uint8Array,
): Promise<EncryptedBlob> {
  const iv = generateIv();
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: toArrayBuffer(iv),
      ...(additionalData
        ? { additionalData: toArrayBuffer(additionalData) }
        : {}),
    },
    key,
    toArrayBuffer(plaintext),
  );

  return { ciphertext: new Uint8Array(ciphertext), iv };
}

export async function decryptAesGcm(
  key: CryptoKey,
  blob: EncryptedBlob,
  additionalData?: Uint8Array,
): Promise<Uint8Array> {
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: toArrayBuffer(blob.iv),
      ...(additionalData
        ? { additionalData: toArrayBuffer(additionalData) }
        : {}),
    },
    key,
    toArrayBuffer(blob.ciphertext),
  );
  return new Uint8Array(plaintext);
}
