"use client";

import type { EnvelopeFormat } from "@/lib/privacy/secrets/types";

import { decode, encode } from "@msgpack/msgpack";

import {
  type EnrollmentCredential,
  loadSecret,
  storeSecretWithCredential,
} from "@/lib/privacy/secrets";
import { SECRET_TYPES } from "@/lib/privacy/secrets/types";
import { trpc } from "@/lib/trpc/client";

export interface StoredFheKeys {
  clientKey: Uint8Array;
  createdAt: string;
  keyId?: string | undefined;
  publicKey: Uint8Array;
  publicKeyFingerprint?: string | undefined;
  serverKey: Uint8Array;
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
    publicKeyFingerprint:
      typeof metadata?.publicKeyFingerprint === "string"
        ? metadata.publicKeyFingerprint
        : undefined,
  };
}

function cacheKeys(secretId: string, keys: StoredFheKeys) {
  cached = { keys, secretId, cachedAt: Date.now() };
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

export async function storeFheKeysWithCredential(params: {
  keys: StoredFheKeys;
  credential: EnrollmentCredential;
  baseCommitment?: string;
}): Promise<{ secretId: string }> {
  const secretPayload = serializeKeys(params.keys);
  const result = await storeSecretWithCredential({
    secretType: SECRET_TYPE,
    plaintext: secretPayload,
    credential: params.credential,
    envelopeFormat: FHE_ENVELOPE_FORMAT,
    baseCommitment: params.baseCommitment,
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

  if (keys.publicKeyFingerprint) {
    const { computePublicKeyFingerprint } = await import("./fingerprint");
    const actual = await computePublicKeyFingerprint(keys.publicKey);
    if (actual !== keys.publicKeyFingerprint) {
      throw new Error("FHE public key fingerprint mismatch.");
    }
  }

  cacheKeys(result.secretId, keys);
  return keys;
}

export async function persistFheKeyId(
  keyId: string,
  publicKeyFingerprint?: string
): Promise<void> {
  let fingerprint = publicKeyFingerprint;
  if (!fingerprint && cached?.keys.publicKey) {
    const { computePublicKeyFingerprint } = await import("./fingerprint");
    fingerprint = await computePublicKeyFingerprint(cached.keys.publicKey);
  }

  await trpc.secrets.updateSecretMetadata.mutate({
    secretType: SECRET_TYPE,
    metadata: {
      keyId,
      ...(fingerprint ? { publicKeyFingerprint: fingerprint } : {}),
    },
  });

  if (cached) {
    cached.keys.keyId = keyId;
    if (fingerprint) {
      cached.keys.publicKeyFingerprint = fingerprint;
    }
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
