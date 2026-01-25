/**
 * Shared DEK Wrapping Module
 *
 * Centralizes the AES-GCM wrapping/unwrapping pattern used by all credential types.
 * Each credential module (passkey, OPAQUE, wallet) derives the KEK differently,
 * but the wrapping/unwrapping logic is identical.
 */

import { encodeAad, WRAP_AAD_CONTEXT } from "@/lib/privacy/primitives/aad";
import { decryptAesGcm, encryptAesGcm } from "@/lib/privacy/primitives/aes-gcm";
import { base64ToBytes, bytesToBase64 } from "@/lib/utils/base64";

interface WrappedDekPayload {
  alg: "AES-GCM";
  iv: string;
  ciphertext: string;
}

function serializeWrappedDek(payload: WrappedDekPayload): string {
  return JSON.stringify(payload);
}

function parseWrappedDek(blob: string): WrappedDekPayload {
  const parsed = JSON.parse(blob) as WrappedDekPayload;
  if (!(parsed?.iv && parsed?.ciphertext)) {
    throw new Error("Invalid wrapped DEK payload.");
  }
  return parsed;
}

/**
 * Wrap a DEK using a pre-derived KEK.
 *
 * The AAD binds the wrapped DEK to:
 * - Secret ID (prevents key substitution)
 * - Credential ID (identifies which credential wrapped this)
 * - User ID (prevents cross-user attacks)
 */
export async function wrapDek(params: {
  secretId: string;
  credentialId: string;
  userId: string;
  dek: Uint8Array;
  kek: CryptoKey;
}): Promise<string> {
  const aad = encodeAad([
    WRAP_AAD_CONTEXT,
    params.secretId,
    params.credentialId,
    params.userId,
  ]);
  const wrapped = await encryptAesGcm(params.kek, params.dek, aad);

  const payload: WrappedDekPayload = {
    alg: "AES-GCM",
    iv: bytesToBase64(wrapped.iv),
    ciphertext: bytesToBase64(wrapped.ciphertext),
  };

  return serializeWrappedDek(payload);
}

/**
 * Unwrap a DEK using a pre-derived KEK.
 */
export function unwrapDek(params: {
  secretId: string;
  credentialId: string;
  userId: string;
  wrappedDek: string;
  kek: CryptoKey;
}): Promise<Uint8Array> {
  const payload = parseWrappedDek(params.wrappedDek);
  const aad = encodeAad([
    WRAP_AAD_CONTEXT,
    params.secretId,
    params.credentialId,
    params.userId,
  ]);

  return decryptAesGcm(
    params.kek,
    {
      iv: base64ToBytes(payload.iv),
      ciphertext: base64ToBytes(payload.ciphertext),
    },
    aad
  );
}
