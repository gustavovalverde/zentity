"use client";

import "client-only";

/**
 * OPAQUE Credential Module
 *
 * Handles OPAQUE password-based KEK derivation and DEK wrapping.
 * The OPAQUE export key (64 bytes) is derived during authentication
 * and provides equivalent security to passkey PRF output.
 */

import { OPAQUE_CREDENTIAL_ID } from "@/lib/privacy/secrets/catalog";

import { deriveKekFromOpaqueExport } from "./derivation";
import { unwrapDek, wrapDek } from "./wrap";

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
