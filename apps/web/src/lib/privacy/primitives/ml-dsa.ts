import { ml_dsa65 } from "@noble/post-quantum/ml-dsa.js";

export const ML_DSA_PUBLIC_KEY_BYTES = 1952;
export const ML_DSA_SECRET_KEY_BYTES = 4032;
export const ML_DSA_SIGNATURE_BYTES = 3309;

export function mlDsaKeygen(seed?: Uint8Array): {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
} {
  if (seed !== undefined && seed.length !== 32) {
    throw new Error(
      `ML-DSA-65 keygen seed must be 32 bytes, got ${seed.length}`
    );
  }
  return ml_dsa65.keygen(seed);
}

export function mlDsaSign(
  message: Uint8Array,
  secretKey: Uint8Array
): Uint8Array {
  if (secretKey.length !== ML_DSA_SECRET_KEY_BYTES) {
    throw new Error(
      `ML-DSA-65 secret key must be ${ML_DSA_SECRET_KEY_BYTES} bytes, got ${secretKey.length}`
    );
  }
  return ml_dsa65.sign(message, secretKey);
}

export function mlDsaVerify(
  signature: Uint8Array,
  message: Uint8Array,
  publicKey: Uint8Array
): boolean {
  if (publicKey.length !== ML_DSA_PUBLIC_KEY_BYTES) {
    throw new Error(
      `ML-DSA-65 public key must be ${ML_DSA_PUBLIC_KEY_BYTES} bytes, got ${publicKey.length}`
    );
  }
  return ml_dsa65.verify(signature, message, publicKey);
}
