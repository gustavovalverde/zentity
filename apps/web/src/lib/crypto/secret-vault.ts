"use client";

import { trpc } from "@/lib/trpc/client";
import { base64ToBytes, bytesToBase64 } from "@/lib/utils/base64";

import {
  createOpaqueWrapper,
  decryptSecretWithOpaqueExport,
  OPAQUE_CREDENTIAL_ID,
} from "./opaque-vault";
import {
  decryptSecretEnvelope,
  type EnvelopeFormat,
  encryptSecretWithDek,
  generateDek,
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

export interface OpaqueEnrollmentContext {
  userId: string;
  exportKey: Uint8Array;
}

export type EnrollmentCredential =
  | { type: "passkey"; context: PasskeyEnrollmentContext }
  | { type: "opaque"; context: OpaqueEnrollmentContext };

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
let cachedRecoveryKey: { keyId: string; cryptoKey: CryptoKey } | null = null;

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

async function getRecoveryEncryptionKey(): Promise<{
  keyId: string;
  cryptoKey: CryptoKey;
}> {
  if (cachedRecoveryKey) {
    return cachedRecoveryKey;
  }

  const { keyId, jwk } = await trpc.recovery.publicKey.query();
  const cryptoKey = await crypto.subtle.importKey(
    "jwk",
    jwk,
    {
      name: "RSA-OAEP",
      hash: "SHA-256",
    },
    false,
    ["encrypt"]
  );

  cachedRecoveryKey = { keyId, cryptoKey };
  return cachedRecoveryKey;
}

async function encryptDekForRecovery(dek: Uint8Array): Promise<{
  wrappedDek: string;
  keyId: string;
}> {
  const { keyId, cryptoKey } = await getRecoveryEncryptionKey();
  const dekCopy = new Uint8Array(dek.byteLength);
  dekCopy.set(dek);
  const encrypted = await crypto.subtle.encrypt(
    { name: "RSA-OAEP" },
    cryptoKey,
    dekCopy
  );
  return { wrappedDek: bytesToBase64(new Uint8Array(encrypted)), keyId };
}

export async function storeSecret(params: {
  secretType: string;
  plaintext: Uint8Array;
  enrollment: PasskeyEnrollmentContext;
  envelopeFormat: EnvelopeFormat;
  metadata?: Record<string, unknown> | null;
}): Promise<{ secretId: string; envelopeFormat: EnvelopeFormat }> {
  const secretId = crypto.randomUUID();
  const dek = generateDek();
  const envelope = await encryptSecretWithDek({
    secretId,
    secretType: params.secretType,
    plaintext: params.plaintext,
    dek,
    envelopeFormat: params.envelopeFormat,
  });
  const wrappedDek = await wrapDekWithPrf({
    secretId,
    credentialId: params.enrollment.credentialId,
    dek,
    prfOutput: params.enrollment.prfOutput,
  });
  const prfSalt = bytesToBase64(params.enrollment.prfSalt);

  const blobMetadata = await uploadSecretBlob({
    secretId: envelope.secretId,
    secretType: params.secretType,
    payload: envelope.encryptedBlob,
  });

  await trpc.secrets.storeSecret.mutate({
    secretId,
    secretType: params.secretType,
    blobRef: blobMetadata.blobRef,
    blobHash: blobMetadata.blobHash,
    blobSize: blobMetadata.blobSize,
    wrappedDek,
    prfSalt,
    credentialId: params.enrollment.credentialId,
    metadata: mergeSecretMetadata({
      envelopeFormat: params.envelopeFormat,
      metadata: params.metadata,
    }),
    version: PASSKEY_VAULT_VERSION,
    kekVersion: WRAP_VERSION,
  });

  try {
    const recovery = await encryptDekForRecovery(dek);
    await trpc.recovery.storeSecretWrapper.mutate({
      secretId,
      wrappedDek: recovery.wrappedDek,
      keyId: recovery.keyId,
    });
  } catch {
    // Recovery wrappers are optional until recovery is enabled.
  }

  return { secretId, envelopeFormat: params.envelopeFormat };
}

/**
 * Store a secret with support for both passkey and OPAQUE credential types.
 * This is the recommended function for new code that needs to support both credential types.
 */
export async function storeSecretWithCredential(params: {
  secretType: string;
  plaintext: Uint8Array;
  credential: EnrollmentCredential;
  envelopeFormat: EnvelopeFormat;
  metadata?: Record<string, unknown> | null;
}): Promise<{ secretId: string; envelopeFormat: EnvelopeFormat }> {
  const secretId = crypto.randomUUID();
  const dek = generateDek();
  const envelope = await encryptSecretWithDek({
    secretId,
    secretType: params.secretType,
    plaintext: params.plaintext,
    dek,
    envelopeFormat: params.envelopeFormat,
  });

  let wrappedDek: string;
  let credentialId: string;
  let prfSalt: string;
  let kekSource: "prf" | "opaque" | "recovery";

  if (params.credential.type === "passkey") {
    const ctx = params.credential.context;
    wrappedDek = await wrapDekWithPrf({
      secretId,
      credentialId: ctx.credentialId,
      dek,
      prfOutput: ctx.prfOutput,
    });
    credentialId = ctx.credentialId;
    prfSalt = bytesToBase64(ctx.prfSalt);
    kekSource = "prf";
  } else {
    const ctx = params.credential.context;
    const { wrapDekWithOpaqueExport } = await import("./opaque-vault");
    wrappedDek = await wrapDekWithOpaqueExport({
      secretId,
      userId: ctx.userId,
      dek,
      exportKey: ctx.exportKey,
    });
    credentialId = OPAQUE_CREDENTIAL_ID;
    prfSalt = ""; // OPAQUE doesn't use PRF salt
    kekSource = "opaque";
  }

  const blobMetadata = await uploadSecretBlob({
    secretId: envelope.secretId,
    secretType: params.secretType,
    payload: envelope.encryptedBlob,
  });

  await trpc.secrets.storeSecret.mutate({
    secretId,
    secretType: params.secretType,
    blobRef: blobMetadata.blobRef,
    blobHash: blobMetadata.blobHash,
    blobSize: blobMetadata.blobSize,
    wrappedDek,
    prfSalt,
    credentialId,
    kekSource,
    metadata: mergeSecretMetadata({
      envelopeFormat: params.envelopeFormat,
      metadata: params.metadata,
    }),
    version: PASSKEY_VAULT_VERSION,
    kekVersion: WRAP_VERSION,
  });

  try {
    const recovery = await encryptDekForRecovery(dek);
    await trpc.recovery.storeSecretWrapper.mutate({
      secretId,
      wrappedDek: recovery.wrappedDek,
      keyId: recovery.keyId,
    });
  } catch {
    // Recovery wrappers are optional until recovery is enabled.
  }

  return { secretId, envelopeFormat: params.envelopeFormat };
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

  // Only include PRF-based wrappers (those with prfSalt)
  const prfWrappers = bundle.wrappers.filter((w) => w.prfSalt);
  if (prfWrappers.length === 0) {
    throw new Error(`No passkeys are registered for this ${label}.`);
  }

  const saltByCredential: Record<string, Uint8Array> = {};
  for (const wrapper of prfWrappers) {
    if (!wrapper.prfSalt) {
      continue;
    }
    saltByCredential[wrapper.credentialId] = base64ToBytes(wrapper.prfSalt);
  }

  const { credentialId: unlockedCredentialId, prfOutput } =
    await resolvePasskeyUnlock({
      credentialIdToSalt: saltByCredential,
    });

  const selectedWrapper = prfWrappers.find(
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

  // Only include PRF-based wrappers (those with prfSalt)
  const prfWrappers = bundle.wrappers.filter((w) => w.prfSalt);
  if (prfWrappers.length === 0) {
    throw new Error("No passkeys are registered for this secret.");
  }

  const saltByCredential: Record<string, Uint8Array> = {};
  for (const wrapper of prfWrappers) {
    if (!wrapper.prfSalt) {
      continue;
    }
    saltByCredential[wrapper.credentialId] = base64ToBytes(wrapper.prfSalt);
  }

  const { credentialId: unlockedCredentialId, prfOutput: selectedOutput } =
    await resolvePasskeyUnlock({
      credentialIdToSalt: saltByCredential,
    });

  const selectedWrapper = prfWrappers.find(
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

export async function addRecoveryWrapperForSecretType(params: {
  secretType: string;
}): Promise<boolean> {
  const bundle = await trpc.secrets.getSecretBundle.query({
    secretType: params.secretType,
  });

  if (!(bundle.secret && bundle.wrappers?.length)) {
    return false;
  }

  // Only include PRF-based wrappers (those with prfSalt)
  const prfWrappers = bundle.wrappers.filter((w) => w.prfSalt);
  if (prfWrappers.length === 0) {
    throw new Error("No passkeys are registered for this secret.");
  }

  const saltByCredential: Record<string, Uint8Array> = {};
  for (const wrapper of prfWrappers) {
    if (!wrapper.prfSalt) {
      continue;
    }
    saltByCredential[wrapper.credentialId] = base64ToBytes(wrapper.prfSalt);
  }

  const { credentialId: unlockedCredentialId, prfOutput } =
    await resolvePasskeyUnlock({
      credentialIdToSalt: saltByCredential,
    });

  const selectedWrapper = prfWrappers.find(
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

  const dek = await unwrapDekWithPrf({
    secretId: bundle.secret.id,
    credentialId: selectedWrapper.credentialId,
    wrappedDek: selectedWrapper.wrappedDek,
    prfOutput,
  });

  const recovery = await encryptDekForRecovery(dek);

  await trpc.recovery.storeSecretWrapper.mutate({
    secretId: bundle.secret.id,
    wrappedDek: recovery.wrappedDek,
    keyId: recovery.keyId,
  });

  return true;
}

/**
 * Add an OPAQUE-based wrapper for a secret type.
 * Used when a user sets up a password after already having PRF-based wrappers.
 * The export key from OPAQUE login/registration is used to wrap the DEK.
 */
export async function addOpaqueWrapperForSecretType(params: {
  secretType: string;
  userId: string;
  exportKey: Uint8Array;
}): Promise<boolean> {
  const bundle = await trpc.secrets.getSecretBundle.query({
    secretType: params.secretType,
  });

  if (!(bundle.secret && bundle.wrappers?.length)) {
    return false;
  }

  // Check if OPAQUE wrapper already exists
  const existingOpaqueWrapper = bundle.wrappers.find(
    (w) => w.credentialId === OPAQUE_CREDENTIAL_ID
  );
  if (existingOpaqueWrapper) {
    // Already has OPAQUE wrapper, skip
    return true;
  }

  // Find a PRF wrapper to unwrap the DEK
  const prfWrappers = bundle.wrappers.filter(
    (w) => w.prfSalt && w.credentialId !== OPAQUE_CREDENTIAL_ID
  );
  if (prfWrappers.length === 0) {
    throw new Error("No PRF wrappers available to derive DEK.");
  }

  const saltByCredential: Record<string, Uint8Array> = {};
  for (const wrapper of prfWrappers) {
    if (wrapper.prfSalt) {
      saltByCredential[wrapper.credentialId] = base64ToBytes(wrapper.prfSalt);
    }
  }

  const { credentialId: unlockedCredentialId, prfOutput } =
    await resolvePasskeyUnlock({
      credentialIdToSalt: saltByCredential,
    });

  const selectedWrapper = prfWrappers.find(
    (wrapper) => wrapper.credentialId === unlockedCredentialId
  );
  if (!selectedWrapper) {
    throw new Error("Selected passkey is not registered for this secret.");
  }

  // Unwrap DEK with PRF
  const dek = await unwrapDekWithPrf({
    secretId: bundle.secret.id,
    credentialId: selectedWrapper.credentialId,
    wrappedDek: selectedWrapper.wrappedDek,
    prfOutput,
  });

  // Create OPAQUE wrapper
  const opaqueWrapper = await createOpaqueWrapper({
    secretId: bundle.secret.id,
    userId: params.userId,
    dek,
    exportKey: params.exportKey,
  });

  // Store the wrapper
  await trpc.secrets.addWrapper.mutate({
    secretId: bundle.secret.id,
    secretType: params.secretType,
    credentialId: opaqueWrapper.credentialId,
    wrappedDek: opaqueWrapper.wrappedDek,
    kekVersion: opaqueWrapper.kekVersion,
    kekSource: opaqueWrapper.kekSource,
  });

  return true;
}

/**
 * Load a secret using OPAQUE export key.
 * Used when user logs in with password instead of passkey.
 * @internal Reserved for future use in password-based login flow.
 */
async function _loadSecretWithOpaqueExport(params: {
  secretType: string;
  userId: string;
  exportKey: Uint8Array;
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
    throw new Error(`No wrappers are registered for this ${label}.`);
  }

  // Find OPAQUE wrapper
  const opaqueWrapper = bundle.wrappers.find(
    (w) => w.credentialId === OPAQUE_CREDENTIAL_ID
  );

  if (!opaqueWrapper) {
    throw new Error(
      `No password wrapper found for this ${label}. Please set up a password first.`
    );
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

  const plaintext = await decryptSecretWithOpaqueExport({
    secretId: bundle.secret.id,
    secretType: params.secretType,
    userId: params.userId,
    encryptedBlob,
    wrappedDek: opaqueWrapper.wrappedDek,
    exportKey: params.exportKey,
    envelopeFormat,
  });

  return {
    secretId: bundle.secret.id,
    plaintext,
    metadata: bundle.secret.metadata,
    envelopeFormat,
  };
}

/**
 * Update OPAQUE wrapper after password change.
 * The old export key is used to unwrap, and new export key re-wraps the DEK.
 */
export async function updateOpaqueWrapperForSecretType(params: {
  secretType: string;
  userId: string;
  oldExportKey: Uint8Array;
  newExportKey: Uint8Array;
}): Promise<boolean> {
  const bundle = await trpc.secrets.getSecretBundle.query({
    secretType: params.secretType,
  });

  if (!(bundle.secret && bundle.wrappers?.length)) {
    return false;
  }

  // Find existing OPAQUE wrapper
  const existingWrapper = bundle.wrappers.find(
    (w) => w.credentialId === OPAQUE_CREDENTIAL_ID
  );

  if (!existingWrapper) {
    // No existing OPAQUE wrapper, create new one
    return addOpaqueWrapperForSecretType({
      secretType: params.secretType,
      userId: params.userId,
      exportKey: params.newExportKey,
    });
  }

  // Unwrap DEK with old export key
  const { unwrapDekWithOpaqueExport } = await import("./opaque-vault");
  const dek = await unwrapDekWithOpaqueExport({
    secretId: bundle.secret.id,
    userId: params.userId,
    wrappedDek: existingWrapper.wrappedDek,
    exportKey: params.oldExportKey,
  });

  // Create new wrapper with new export key
  const newWrapper = await createOpaqueWrapper({
    secretId: bundle.secret.id,
    userId: params.userId,
    dek,
    exportKey: params.newExportKey,
  });

  // upsertSecretWrapper handles update on conflict (secretId, credentialId)
  await trpc.secrets.addWrapper.mutate({
    secretId: bundle.secret.id,
    secretType: params.secretType,
    credentialId: newWrapper.credentialId,
    wrappedDek: newWrapper.wrappedDek,
    kekVersion: newWrapper.kekVersion,
    kekSource: newWrapper.kekSource,
  });

  return true;
}
