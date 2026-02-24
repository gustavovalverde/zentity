import { ml_kem768 } from "@noble/post-quantum/ml-kem.js";

export const ML_KEM_PUBLIC_KEY_BYTES = 1184;
export const ML_KEM_SECRET_KEY_BYTES = 2400;
export const ML_KEM_CIPHERTEXT_BYTES = 1088;
export const ML_KEM_SHARED_SECRET_BYTES = 32;

export function mlKemKeygen(seed?: Uint8Array): {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
} {
  if (seed !== undefined && seed.length !== 64) {
    throw new Error(
      `ML-KEM-768 keygen seed must be 64 bytes, got ${seed.length}`
    );
  }
  return ml_kem768.keygen(seed);
}

export function mlKemGetPublicKey(secretKey: Uint8Array): Uint8Array {
  if (secretKey.length !== ML_KEM_SECRET_KEY_BYTES) {
    throw new Error(
      `ML-KEM-768 secret key must be ${ML_KEM_SECRET_KEY_BYTES} bytes, got ${secretKey.length}`
    );
  }
  return ml_kem768.getPublicKey(secretKey);
}

export function mlKemEncapsulate(publicKey: Uint8Array): {
  cipherText: Uint8Array;
  sharedSecret: Uint8Array;
} {
  if (publicKey.length !== ML_KEM_PUBLIC_KEY_BYTES) {
    throw new Error(
      `ML-KEM-768 public key must be ${ML_KEM_PUBLIC_KEY_BYTES} bytes, got ${publicKey.length}`
    );
  }
  return ml_kem768.encapsulate(publicKey);
}

export function mlKemDecapsulate(
  cipherText: Uint8Array,
  secretKey: Uint8Array
): Uint8Array {
  if (cipherText.length !== ML_KEM_CIPHERTEXT_BYTES) {
    throw new Error(
      `ML-KEM-768 ciphertext must be ${ML_KEM_CIPHERTEXT_BYTES} bytes, got ${cipherText.length}`
    );
  }
  if (secretKey.length !== ML_KEM_SECRET_KEY_BYTES) {
    throw new Error(
      `ML-KEM-768 secret key must be ${ML_KEM_SECRET_KEY_BYTES} bytes, got ${secretKey.length}`
    );
  }
  return ml_kem768.decapsulate(cipherText, secretKey);
}

export function isValidMlKemPublicKey(base64: string): boolean {
  try {
    const bytes = Buffer.from(base64, "base64");
    return bytes.length === ML_KEM_PUBLIC_KEY_BYTES;
  } catch {
    return false;
  }
}
