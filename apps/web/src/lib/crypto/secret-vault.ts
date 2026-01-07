"use client";

import { trpc } from "@/lib/trpc/client";
import { base64ToBytes, bytesToBase64 } from "@/lib/utils/base64";

import {
  createSecretEnvelope,
  decryptSecretEnvelope,
  type EnvelopeFormat,
  PASSKEY_VAULT_VERSION,
  unwrapDekWithPrf,
  WRAP_VERSION,
  wrapDekWithPrf,
} from "./passkey-vault";
import { downloadSecretBlob, uploadSecretBlob } from "./secret-blob-client";
import { evaluatePrf } from "./webauthn-prf";

export interface PasskeyEnrollmentContext {
  credentialId: string;
  prfOutput: Uint8Array;
  prfSalt: Uint8Array;
}

export const ENVELOPE_FORMAT_METADATA_KEY = "envelopeFormat";
const PASSKEY_CACHE_TTL_MS = 15 * 60 * 1000;

interface CachedPasskeyUnlock {
  credentialId: string;
  prfOutput: Uint8Array;
  cachedAt: number;
}

let cachedUnlock: CachedPasskeyUnlock | null = null;
let pendingUnlock: Promise<CachedPasskeyUnlock> | null = null;
let pendingUnlockKey: string | null = null;

function getCachedUnlock(
  allowedCredentialIds: string[]
): CachedPasskeyUnlock | null {
  if (!cachedUnlock) {
    return null;
  }
  if (Date.now() - cachedUnlock.cachedAt > PASSKEY_CACHE_TTL_MS) {
    cachedUnlock = null;
    return null;
  }
  if (!allowedCredentialIds.includes(cachedUnlock.credentialId)) {
    return null;
  }
  return cachedUnlock;
}

export function cachePasskeyUnlock(params: {
  credentialId: string;
  prfOutput: Uint8Array;
}): void {
  cachedUnlock = {
    credentialId: params.credentialId,
    prfOutput: params.prfOutput,
    cachedAt: Date.now(),
  };
}

export function resetPasskeyUnlockCache(): void {
  cachedUnlock = null;
  pendingUnlock = null;
  pendingUnlockKey = null;
}

export function hasCachedPasskeyUnlock(): boolean {
  if (!cachedUnlock) {
    return false;
  }
  if (Date.now() - cachedUnlock.cachedAt > PASSKEY_CACHE_TTL_MS) {
    cachedUnlock = null;
    return false;
  }
  return true;
}

async function resolvePasskeyUnlock(params: {
  credentialIdToSalt: Record<string, Uint8Array>;
  credentialTransports?: Record<string, AuthenticatorTransport[]>;
}): Promise<CachedPasskeyUnlock> {
  const credentialIds = Object.keys(params.credentialIdToSalt);
  if (credentialIds.length === 0) {
    throw new Error("No passkeys are registered for this secret.");
  }

  const cached = getCachedUnlock(credentialIds);
  if (cached) {
    return cached;
  }

  const pendingKey = [...credentialIds].sort().join("|");
  if (pendingUnlock && pendingUnlockKey === pendingKey) {
    return pendingUnlock;
  }

  const unlockPromise = (async () => {
    const { prfOutputs, selectedCredentialId } = await evaluatePrf({
      credentialIdToSalt: params.credentialIdToSalt,
      credentialTransports: params.credentialTransports,
    });

    const resolvedCredentialId =
      (selectedCredentialId && prfOutputs.has(selectedCredentialId)
        ? selectedCredentialId
        : null) ??
      credentialIds.find((id) => prfOutputs.has(id)) ??
      prfOutputs.keys().next().value;

    const prfOutput = resolvedCredentialId
      ? prfOutputs.get(resolvedCredentialId)
      : null;

    if (!(resolvedCredentialId && prfOutput)) {
      throw new Error("PRF output missing for selected passkey.");
    }

    cachePasskeyUnlock({
      credentialId: resolvedCredentialId,
      prfOutput,
    });

    return {
      credentialId: resolvedCredentialId,
      prfOutput,
      cachedAt: Date.now(),
    };
  })();

  pendingUnlock = unlockPromise;
  pendingUnlockKey = pendingKey;

  try {
    return await unlockPromise;
  } finally {
    if (pendingUnlock === unlockPromise) {
      pendingUnlock = null;
      pendingUnlockKey = null;
    }
  }
}

export function readEnvelopeFormat(
  metadata: Record<string, unknown> | null | undefined
): EnvelopeFormat | null {
  const value = metadata?.[ENVELOPE_FORMAT_METADATA_KEY];
  return value === "json" || value === "msgpack" ? value : null;
}

export function mergeSecretMetadata(params: {
  envelopeFormat: EnvelopeFormat;
  metadata?: Record<string, unknown> | null;
}): Record<string, unknown> {
  return {
    ...(params.metadata ?? {}),
    [ENVELOPE_FORMAT_METADATA_KEY]: params.envelopeFormat,
  };
}

export async function storeSecret(params: {
  secretType: string;
  plaintext: Uint8Array;
  enrollment: PasskeyEnrollmentContext;
  envelopeFormat: EnvelopeFormat;
  metadata?: Record<string, unknown> | null;
}): Promise<{ secretId: string; envelopeFormat: EnvelopeFormat }> {
  const envelope = await createSecretEnvelope({
    secretType: params.secretType,
    plaintext: params.plaintext,
    prfOutput: params.enrollment.prfOutput,
    credentialId: params.enrollment.credentialId,
    prfSalt: params.enrollment.prfSalt,
    envelopeFormat: params.envelopeFormat,
  });

  const blobMetadata = await uploadSecretBlob({
    secretId: envelope.secretId,
    secretType: params.secretType,
    payload: envelope.encryptedBlob,
  });

  await trpc.secrets.storeSecret.mutate({
    secretId: envelope.secretId,
    secretType: params.secretType,
    blobRef: blobMetadata.blobRef,
    blobHash: blobMetadata.blobHash,
    blobSize: blobMetadata.blobSize,
    wrappedDek: envelope.wrappedDek,
    prfSalt: envelope.prfSalt,
    credentialId: params.enrollment.credentialId,
    metadata: mergeSecretMetadata({
      envelopeFormat: params.envelopeFormat,
      metadata: params.metadata,
    }),
    version: PASSKEY_VAULT_VERSION,
    kekVersion: WRAP_VERSION,
  });

  return { secretId: envelope.secretId, envelopeFormat: params.envelopeFormat };
}

export async function loadSecret(params: {
  secretType: string;
  expectedEnvelopeFormat?: EnvelopeFormat;
  secretLabel?: string;
}): Promise<{
  secretId: string;
  plaintext: Uint8Array;
  metadata: Record<string, unknown> | null;
  envelopeFormat: EnvelopeFormat;
} | null> {
  const bundle = await trpc.secrets.getSecretBundle.query({
    secretType: params.secretType,
  });

  if (!bundle?.secret) {
    return null;
  }

  const label = params.secretLabel ?? "secret";

  if (bundle.secret.version !== PASSKEY_VAULT_VERSION) {
    throw new Error(
      `Unsupported ${label} version. Please re-secure your ${label}.`
    );
  }

  if (!bundle.wrappers?.length) {
    throw new Error(`No passkeys are registered for this ${label}.`);
  }

  if (!bundle.secret.blobRef) {
    throw new Error(`Encrypted ${label} blob is missing.`);
  }

  const encryptedBlob = await downloadSecretBlob(bundle.secret.id);

  const storedFormat = readEnvelopeFormat(bundle.secret.metadata);
  if (
    storedFormat &&
    params.expectedEnvelopeFormat &&
    storedFormat !== params.expectedEnvelopeFormat
  ) {
    throw new Error(
      `Secret envelope format mismatch. Please re-secure your ${label}.`
    );
  }

  const envelopeFormat = storedFormat ?? params.expectedEnvelopeFormat;
  if (!envelopeFormat) {
    throw new Error(
      `Missing envelope format metadata. Please re-secure your ${label}.`
    );
  }

  const saltByCredential: Record<string, Uint8Array> = {};
  for (const wrapper of bundle.wrappers) {
    saltByCredential[wrapper.credentialId] = base64ToBytes(wrapper.prfSalt);
  }

  const { credentialId: unlockedCredentialId, prfOutput } =
    await resolvePasskeyUnlock({
      credentialIdToSalt: saltByCredential,
    });

  const selectedWrapper = bundle.wrappers.find(
    (wrapper) => wrapper.credentialId === unlockedCredentialId
  );
  if (!selectedWrapper) {
    throw new Error("Selected passkey is not registered for this secret.");
  }
  if (selectedWrapper.kekVersion !== WRAP_VERSION) {
    throw new Error(
      "Unsupported key wrapper version. Please re-add your passkey."
    );
  }

  const plaintext = await decryptSecretEnvelope({
    secretId: bundle.secret.id,
    secretType: params.secretType,
    encryptedBlob,
    wrappedDek: selectedWrapper.wrappedDek,
    credentialId: selectedWrapper.credentialId,
    prfOutput,
    envelopeFormat,
  });

  return {
    secretId: bundle.secret.id,
    plaintext,
    metadata: bundle.secret.metadata,
    envelopeFormat,
  };
}

export async function addWrapperForSecretType(params: {
  secretType: string;
  newCredentialId: string;
  newPrfOutput: Uint8Array;
  newPrfSalt: Uint8Array;
  kekVersion?: string;
}): Promise<boolean> {
  const bundle = await trpc.secrets.getSecretBundle.query({
    secretType: params.secretType,
  });

  if (!(bundle.secret && bundle.wrappers?.length)) {
    return false;
  }

  const saltByCredential: Record<string, Uint8Array> = {};
  for (const wrapper of bundle.wrappers) {
    saltByCredential[wrapper.credentialId] = base64ToBytes(wrapper.prfSalt);
  }

  const { credentialId: unlockedCredentialId, prfOutput: selectedOutput } =
    await resolvePasskeyUnlock({
      credentialIdToSalt: saltByCredential,
    });

  const selectedWrapper = bundle.wrappers.find(
    (wrapper) => wrapper.credentialId === unlockedCredentialId
  );
  if (!selectedWrapper) {
    throw new Error("Selected passkey is not registered for this secret.");
  }

  const dek = await unwrapDekWithPrf({
    secretId: bundle.secret.id,
    credentialId: selectedWrapper.credentialId,
    wrappedDek: selectedWrapper.wrappedDek,
    prfOutput: selectedOutput,
  });

  const wrappedDek = await wrapDekWithPrf({
    secretId: bundle.secret.id,
    credentialId: params.newCredentialId,
    dek,
    prfOutput: params.newPrfOutput,
  });

  await trpc.secrets.addWrapper.mutate({
    secretId: bundle.secret.id,
    secretType: params.secretType,
    credentialId: params.newCredentialId,
    wrappedDek,
    prfSalt: bytesToBase64(params.newPrfSalt),
    kekVersion: params.kekVersion ?? WRAP_VERSION,
  });

  return true;
}
