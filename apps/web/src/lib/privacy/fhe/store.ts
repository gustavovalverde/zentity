"use client";

import type { EnvelopeFormat } from "@/lib/privacy/secrets/types";

import { decode, encode } from "@msgpack/msgpack";

import { createSecretEnvelope } from "@/lib/privacy/credentials";
import {
  type EnrollmentCredential,
  loadSecret,
  type PasskeyEnrollmentContext,
  storeSecretWithCredential,
} from "@/lib/privacy/secrets";
import { SECRET_TYPES } from "@/lib/privacy/secrets/types";
import { trpc } from "@/lib/trpc/client";

export interface StoredFheKeys {
  clientKey: Uint8Array;
  publicKey: Uint8Array;
  serverKey: Uint8Array;
  createdAt: string;
  keyId?: string;
}

const SECRET_TYPE = SECRET_TYPES.FHE_KEYS;
const FHE_ENVELOPE_FORMAT: EnvelopeFormat = "msgpack";
const CACHE_TTL_MS = 15 * 60 * 1000;

let cached:
  | {
      keys: StoredFheKeys;
      secretId: string;
      cachedAt: number;
    }
  | undefined;

function serializeKeys(keys: StoredFheKeys): Uint8Array {
  return encode({
    clientKey: keys.clientKey,
    publicKey: keys.publicKey,
    serverKey: keys.serverKey,
    createdAt: keys.createdAt,
  });
}

function deserializeKeys(
  payload: Uint8Array,
  metadata?: Record<string, unknown> | null
): StoredFheKeys {
  const parsed = decode(payload) as {
    clientKey: Uint8Array;
    publicKey: Uint8Array;
    serverKey: Uint8Array;
    createdAt: string;
  };
  return {
    clientKey: parsed.clientKey,
    publicKey: parsed.publicKey,
    serverKey: parsed.serverKey,
    createdAt: parsed.createdAt,
    keyId: typeof metadata?.keyId === "string" ? metadata.keyId : undefined,
  };
}

function cacheKeys(secretId: string, keys: StoredFheKeys) {
  cached = { keys, secretId, cachedAt: Date.now() };
}

export async function createFheKeyEnvelope(params: {
  keys: StoredFheKeys;
  enrollment: PasskeyEnrollmentContext;
}): Promise<{
  secretId: string;
  encryptedBlob: Uint8Array;
  wrappedDek: string;
  prfSalt: string;
  envelopeFormat: EnvelopeFormat;
}> {
  const secretPayload = serializeKeys(params.keys);
  return await createSecretEnvelope({
    secretType: SECRET_TYPE,
    plaintext: secretPayload,
    prfOutput: params.enrollment.prfOutput,
    credentialId: params.enrollment.credentialId,
    userId: params.enrollment.userId,
    prfSalt: params.enrollment.prfSalt,
    envelopeFormat: FHE_ENVELOPE_FORMAT,
  });
}

function getCachedKeys(): StoredFheKeys | null {
  if (!cached) {
    return null;
  }
  if (Date.now() - cached.cachedAt > CACHE_TTL_MS) {
    cached = undefined;
    return null;
  }
  return cached.keys;
}

export async function storeFheKeys(params: {
  keys: StoredFheKeys;
  enrollment: PasskeyEnrollmentContext;
}): Promise<{ secretId: string }> {
  const secretPayload = serializeKeys(params.keys);
  const result = await storeSecretWithCredential({
    secretType: SECRET_TYPE,
    plaintext: secretPayload,
    credential: { type: "passkey", context: params.enrollment },
    envelopeFormat: FHE_ENVELOPE_FORMAT,
  });

  cacheKeys(result.secretId, params.keys);

  return { secretId: result.secretId };
}

/**
 * Store FHE keys with support for both passkey and OPAQUE credential types.
 * This is the recommended function for new code during sign-up.
 */
export async function storeFheKeysWithCredential(params: {
  keys: StoredFheKeys;
  credential: EnrollmentCredential;
}): Promise<{ secretId: string }> {
  const secretPayload = serializeKeys(params.keys);
  const result = await storeSecretWithCredential({
    secretType: SECRET_TYPE,
    plaintext: secretPayload,
    credential: params.credential,
    envelopeFormat: FHE_ENVELOPE_FORMAT,
  });

  cacheKeys(result.secretId, params.keys);

  return { secretId: result.secretId };
}

export async function getStoredFheKeys(): Promise<StoredFheKeys | null> {
  const cachedKeys = getCachedKeys();
  if (cachedKeys) {
    return cachedKeys;
  }

  const result = await loadSecret({
    secretType: SECRET_TYPE,
    expectedEnvelopeFormat: FHE_ENVELOPE_FORMAT,
    secretLabel: "encryption keys",
  });

  if (!result) {
    return null;
  }

  const keys = deserializeKeys(result.plaintext, result.metadata);
  cacheKeys(result.secretId, keys);
  return keys;
}

export async function persistFheKeyId(keyId: string): Promise<void> {
  await trpc.secrets.updateSecretMetadata.mutate({
    secretType: SECRET_TYPE,
    metadata: { keyId },
  });

  if (cached) {
    cached.keys.keyId = keyId;
  }
}

/**
 * Clear the FHE key store cache.
 * Call this during sign-out and before sign-in to ensure clean state
 * when users switch on shared browsers.
 */
export function resetFheKeyStoreCache(): void {
  cached = undefined;
}
