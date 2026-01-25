"use client";

import "client-only";

/**
 * OPAQUE Credential Module
 *
 * Handles OPAQUE password-based KEK derivation and DEK wrapping.
 * The OPAQUE export key (64 bytes) is derived during authentication
 * and provides equivalent security to passkey PRF output.
 */

import type { EnvelopeFormat } from "@/lib/privacy/secrets/types";

import { decryptWithDek } from "@/lib/privacy/secrets/envelope";

import { deriveKekFromOpaqueExport, KEK_SOURCE } from "./derivation";
import { unwrapDek, wrapDek } from "./wrap";

export const OPAQUE_CREDENTIAL_ID = "opaque";

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
  const kek = await deriveKekFromOpaqueExport(params.exportKey, params.userId);
  return wrapDek({
    secretId: params.secretId,
    credentialId: OPAQUE_CREDENTIAL_ID,
    userId: params.userId,
    dek: params.dek,
    kek,
  });
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
  const kek = await deriveKekFromOpaqueExport(params.exportKey, params.userId);
  return unwrapDek({
    secretId: params.secretId,
    credentialId: OPAQUE_CREDENTIAL_ID,
    userId: params.userId,
    wrappedDek: params.wrappedDek,
    kek,
  });
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
  };
}

/**
 * Decrypt a secret envelope using OPAQUE export key.
 * Combines DEK unwrapping with envelope decryption.
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

  return decryptWithDek({
    secretId: params.secretId,
    secretType: params.secretType,
    encryptedBlob: params.encryptedBlob,
    dek,
    envelopeFormat: params.envelopeFormat,
  });
}
