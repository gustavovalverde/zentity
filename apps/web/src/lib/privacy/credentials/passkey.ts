"use client";

import "client-only";

/**
 * Passkey Credential Module
 *
 * Handles passkey (WebAuthn PRF) based KEK derivation and DEK wrapping.
 * The PRF output from the authenticator is used as high-entropy input
 * to HKDF for deriving the KEK.
 */

import type { EnvelopeFormat } from "@/lib/privacy/secrets/types";

import { encryptWithDek, generateDek } from "@/lib/privacy/secrets/envelope";
import { bytesToBase64 } from "@/lib/utils/base64";

import { deriveKekFromPrf } from "./derivation";
import { unwrapDek, wrapDek } from "./wrap";

/**
 * Wrap a DEK using passkey PRF output.
 *
 * @param params.secretId - Unique ID of the secret being wrapped
 * @param params.credentialId - WebAuthn credential ID (base64url)
 * @param params.userId - User ID for KEK derivation salt
 * @param params.dek - Data Encryption Key to wrap
 * @param params.prfOutput - 32-byte PRF output from the authenticator
 * @returns JSON-encoded wrapped DEK payload
 */
export async function wrapDekWithPrf(params: {
  secretId: string;
  credentialId: string;
  userId: string;
  dek: Uint8Array;
  prfOutput: Uint8Array;
}): Promise<string> {
  const kek = await deriveKekFromPrf(params.prfOutput, params.userId);
  return wrapDek({
    secretId: params.secretId,
    credentialId: params.credentialId,
    userId: params.userId,
    dek: params.dek,
    kek,
  });
}

/**
 * Unwrap a DEK using passkey PRF output.
 *
 * @param params.secretId - Unique ID of the secret being unwrapped
 * @param params.credentialId - WebAuthn credential ID (base64url)
 * @param params.userId - User ID for KEK derivation salt
 * @param params.wrappedDek - JSON-encoded wrapped DEK payload
 * @param params.prfOutput - 32-byte PRF output from the authenticator
 * @returns The unwrapped Data Encryption Key
 */
export async function unwrapDekWithPrf(params: {
  secretId: string;
  credentialId: string;
  userId: string;
  wrappedDek: string;
  prfOutput: Uint8Array;
}): Promise<Uint8Array> {
  const kek = await deriveKekFromPrf(params.prfOutput, params.userId);
  return unwrapDek({
    secretId: params.secretId,
    credentialId: params.credentialId,
    userId: params.userId,
    wrappedDek: params.wrappedDek,
    kek,
  });
}

/**
 * Create a complete secret envelope with passkey-wrapped DEK.
 * Combines envelope encryption with passkey PRF-based KEK derivation.
 */
export async function createSecretEnvelope(params: {
  secretType: string;
  plaintext: Uint8Array;
  prfOutput: Uint8Array;
  credentialId: string;
  userId: string;
  prfSalt: Uint8Array;
  secretId?: string;
  envelopeFormat?: EnvelopeFormat;
}): Promise<{
  secretId: string;
  encryptedBlob: Uint8Array;
  wrappedDek: string;
  prfSalt: string;
  envelopeFormat: EnvelopeFormat;
}> {
  const secretId = params.secretId ?? crypto.randomUUID();
  const dek = generateDek();
  const envelopeFormat = params.envelopeFormat ?? "json";

  const secretEnvelope = await encryptWithDek({
    secretId,
    secretType: params.secretType,
    plaintext: params.plaintext,
    dek,
    envelopeFormat,
  });

  const wrapper = await wrapDekWithPrf({
    secretId,
    credentialId: params.credentialId,
    userId: params.userId,
    dek,
    prfOutput: params.prfOutput,
  });

  return {
    secretId: secretEnvelope.secretId,
    encryptedBlob: secretEnvelope.encryptedBlob,
    wrappedDek: wrapper,
    prfSalt: bytesToBase64(params.prfSalt),
    envelopeFormat,
  };
}
