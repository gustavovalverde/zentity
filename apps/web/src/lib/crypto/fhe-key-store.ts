"use client";

import { trpc } from "@/lib/trpc/client";
import { base64ToBytes, bytesToBase64 } from "@/lib/utils/base64";

import {
  createSecretEnvelope,
  decryptSecretEnvelope,
  PASSKEY_VAULT_VERSION,
  WRAP_VERSION,
} from "./passkey-vault";
import { evaluatePrf } from "./webauthn-prf";

export interface StoredFheKeys {
  clientKey: Uint8Array;
  publicKey: Uint8Array;
  serverKey: Uint8Array;
  createdAt: string;
  keyId?: string;
}

export interface PasskeyEnrollmentContext {
  credentialId: string;
  prfOutput: Uint8Array;
  prfSalt: Uint8Array;
}

const SECRET_TYPE = "fhe_keys";
const CACHE_TTL_MS = 15 * 60 * 1000;

let cached:
  | {
      keys: StoredFheKeys;
      secretId: string;
      cachedAt: number;
    }
  | undefined;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

async function uploadSecretBlob(params: {
  secretId: string;
  secretType: string;
  payload: Uint8Array;
}): Promise<{ blobRef: string; blobHash: string; blobSize: number }> {
  const response = await fetch("/api/secrets/blob", {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "X-Secret-Id": params.secretId,
      "X-Secret-Type": params.secretType,
    },
    body: params.payload.buffer as ArrayBuffer,
    credentials: "same-origin",
  });

  if (!response.ok) {
    throw new Error("Failed to upload encrypted secret blob.");
  }

  const result = (await response.json()) as {
    blobRef: string;
    blobHash: string;
    blobSize: number;
  };

  if (!(result?.blobRef && result?.blobHash)) {
    throw new Error("Encrypted secret blob response missing metadata.");
  }

  return result;
}

async function downloadSecretBlob(secretId: string): Promise<string> {
  const response = await fetch(`/api/secrets/blob?secretId=${secretId}`, {
    method: "GET",
    credentials: "same-origin",
  });

  if (response.status === 404) {
    throw new Error(
      "Encrypted secret blob is missing. Please re-secure your encryption keys."
    );
  }

  if (!response.ok) {
    throw new Error("Failed to download encrypted secret blob.");
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  return textDecoder.decode(bytes);
}

function serializeKeys(keys: StoredFheKeys): Uint8Array {
  const payload = JSON.stringify({
    clientKey: bytesToBase64(keys.clientKey),
    publicKey: bytesToBase64(keys.publicKey),
    serverKey: bytesToBase64(keys.serverKey),
    createdAt: keys.createdAt,
  });
  return textEncoder.encode(payload);
}

function deserializeKeys(
  payload: Uint8Array,
  metadata?: Record<string, unknown> | null
): StoredFheKeys {
  const parsed = JSON.parse(textDecoder.decode(payload)) as {
    clientKey: string;
    publicKey: string;
    serverKey: string;
    createdAt: string;
  };
  return {
    clientKey: base64ToBytes(parsed.clientKey),
    publicKey: base64ToBytes(parsed.publicKey),
    serverKey: base64ToBytes(parsed.serverKey),
    createdAt: parsed.createdAt,
    keyId: typeof metadata?.keyId === "string" ? metadata.keyId : undefined,
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

export async function storeFheKeys(params: {
  keys: StoredFheKeys;
  enrollment: PasskeyEnrollmentContext;
}): Promise<{ secretId: string }> {
  const secretPayload = serializeKeys(params.keys);
  const envelope = await createSecretEnvelope({
    secretType: SECRET_TYPE,
    plaintext: secretPayload,
    prfOutput: params.enrollment.prfOutput,
    credentialId: params.enrollment.credentialId,
    prfSalt: params.enrollment.prfSalt,
  });

  const blobMetadata = await uploadSecretBlob({
    secretId: envelope.secretId,
    secretType: SECRET_TYPE,
    payload: textEncoder.encode(envelope.encryptedBlob),
  });

  await trpc.secrets.storeSecret.mutate({
    secretId: envelope.secretId,
    secretType: SECRET_TYPE,
    blobRef: blobMetadata.blobRef,
    blobHash: blobMetadata.blobHash,
    blobSize: blobMetadata.blobSize,
    wrappedDek: envelope.wrappedDek,
    prfSalt: bytesToBase64(params.enrollment.prfSalt),
    credentialId: params.enrollment.credentialId,
    metadata: null,
    version: PASSKEY_VAULT_VERSION,
    kekVersion: WRAP_VERSION,
  });

  cacheKeys(envelope.secretId, params.keys);

  return { secretId: envelope.secretId };
}

export async function getStoredFheKeys(): Promise<StoredFheKeys | null> {
  const cachedKeys = getCachedKeys();
  if (cachedKeys) {
    return cachedKeys;
  }

  const bundle = await trpc.secrets.getSecretBundle.query({
    secretType: SECRET_TYPE,
  });

  if (!bundle?.secret) {
    return null;
  }

  if (bundle.secret.version !== PASSKEY_VAULT_VERSION) {
    throw new Error(
      "Unsupported secret version. Please re-secure your encryption keys."
    );
  }

  if (!bundle.wrappers?.length) {
    throw new Error("No passkeys are registered for this secret.");
  }

  if (!bundle.secret.blobRef) {
    throw new Error("Encrypted secret blob is missing.");
  }

  const encryptedBlob = await downloadSecretBlob(bundle.secret.id);

  const saltByCredential: Record<string, Uint8Array> = {};
  for (const wrapper of bundle.wrappers) {
    saltByCredential[wrapper.credentialId] = base64ToBytes(wrapper.prfSalt);
  }

  const { prfOutputs, selectedCredentialId } = await evaluatePrf({
    credentialIdToSalt: saltByCredential,
  });

  const selectedWrapper =
    bundle.wrappers.find((w) => w.credentialId === selectedCredentialId) ??
    bundle.wrappers[0];
  if (selectedWrapper.kekVersion !== WRAP_VERSION) {
    throw new Error(
      "Unsupported key wrapper version. Please re-add your passkey."
    );
  }
  const prfOutput =
    prfOutputs.get(selectedWrapper.credentialId) ??
    prfOutputs.values().next().value;

  if (!prfOutput) {
    throw new Error("PRF output missing for selected passkey.");
  }

  const plaintext = await decryptSecretEnvelope({
    secretId: bundle.secret.id,
    secretType: SECRET_TYPE,
    encryptedBlob,
    wrappedDek: selectedWrapper.wrappedDek,
    credentialId: selectedWrapper.credentialId,
    prfOutput,
  });

  const keys = deserializeKeys(plaintext, bundle.secret.metadata);
  cacheKeys(bundle.secret.id, keys);
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

export function resetFheKeyStoreForTests() {
  cached = undefined;
}
