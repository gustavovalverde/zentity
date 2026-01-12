"use client";

import "client-only";

import { base64ToBytes, bytesToBase64 } from "@/lib/utils/base64";

import { deriveKekFromOpaqueExport, KEK_SOURCE } from "./key-derivation";
import {
  decryptSecretWithDek,
  type EnvelopeFormat,
  parseWrappedDek,
  serializeWrappedDek,
  WRAP_AAD_VERSION,
  WRAP_VERSION,
  type WrappedDekPayload,
} from "./passkey-vault";
import { decryptAesGcm, encryptAesGcm } from "./symmetric-crypto";

export const OPAQUE_CREDENTIAL_ID = "opaque";

const textEncoder = new TextEncoder();

function encodeAad(parts: string[]): Uint8Array {
  return textEncoder.encode(parts.join("|"));
}

/**
 * Wrap a DEK using OPAQUE export key.
 * Creates a wrapper that can be stored alongside PRF-based wrappers.
 */
export async function wrapDekWithOpaqueExport(params: {
  secretId: string;
  userId: string;
  dek: Uint8Array;
  exportKey: Uint8Array;
}): Promise<string> {
  const aad = encodeAad([
    WRAP_AAD_VERSION,
    params.secretId,
    OPAQUE_CREDENTIAL_ID,
    params.userId,
  ]);
  const kek = await deriveKekFromOpaqueExport(params.exportKey);
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
 * Unwrap a DEK using OPAQUE export key.
 */
export async function unwrapDekWithOpaqueExport(params: {
  secretId: string;
  userId: string;
  wrappedDek: string;
  exportKey: Uint8Array;
}): Promise<Uint8Array> {
  const payload = parseWrappedDek(params.wrappedDek);
  const aad = encodeAad([
    WRAP_AAD_VERSION,
    params.secretId,
    OPAQUE_CREDENTIAL_ID,
    params.userId,
  ]);
  const kek = await deriveKekFromOpaqueExport(params.exportKey);

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
 * Create an OPAQUE wrapper for an existing secret.
 * This is used when a user sets up a password after already having PRF-based wrappers.
 *
 * Returns the wrapper data needed for storage in secret_wrappers table.
 */
export async function createOpaqueWrapper(params: {
  secretId: string;
  userId: string;
  dek: Uint8Array;
  exportKey: Uint8Array;
}): Promise<{
  wrappedDek: string;
  credentialId: string;
  kekSource: typeof KEK_SOURCE.OPAQUE;
  kekVersion: string;
}> {
  const wrappedDek = await wrapDekWithOpaqueExport({
    secretId: params.secretId,
    userId: params.userId,
    dek: params.dek,
    exportKey: params.exportKey,
  });

  return {
    wrappedDek,
    credentialId: OPAQUE_CREDENTIAL_ID,
    kekSource: KEK_SOURCE.OPAQUE,
    kekVersion: "v1",
  };
}

/**
 * Decrypt a secret envelope using OPAQUE export key.
 * This mirrors decryptSecretEnvelope from passkey-vault but uses OPAQUE.
 */
export async function decryptSecretWithOpaqueExport(params: {
  secretId: string;
  secretType: string;
  userId: string;
  encryptedBlob: Uint8Array;
  wrappedDek: string;
  exportKey: Uint8Array;
  envelopeFormat: EnvelopeFormat;
}): Promise<Uint8Array> {
  const dek = await unwrapDekWithOpaqueExport({
    secretId: params.secretId,
    userId: params.userId,
    wrappedDek: params.wrappedDek,
    exportKey: params.exportKey,
  });

  return decryptSecretWithDek({
    secretId: params.secretId,
    secretType: params.secretType,
    encryptedBlob: params.encryptedBlob,
    dek,
    envelopeFormat: params.envelopeFormat,
  });
}
