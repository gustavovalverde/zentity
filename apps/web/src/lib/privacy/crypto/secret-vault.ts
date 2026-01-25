"use client";

import type { SecretType } from "./secret-types";

import { authClient } from "@/lib/auth/auth-client";
import { trpc } from "@/lib/trpc/client";
import { base64ToBytes, bytesToBase64 } from "@/lib/utils/base64";

import {
  createOpaqueWrapper,
  decryptSecretWithOpaqueExport,
  OPAQUE_CREDENTIAL_ID,
  unwrapDekWithOpaqueExport,
} from "./opaque-vault";
import {
  decryptSecretEnvelope,
  type EnvelopeFormat,
  encryptSecretWithDek,
  generateDek,
  unwrapDekWithPrf,
  wrapDekWithPrf,
} from "./passkey-vault";
import { downloadSecretBlob, uploadSecretBlob } from "./secret-blob-client";
import {
  cacheWalletSignature as cacheWalletSig,
  decryptSecretWithWalletSignature,
  getCachedWalletSignature,
  getWalletCredentialId,
  parseWalletCredentialId,
  resetWalletSignatureCache,
  WALLET_CREDENTIAL_PREFIX,
  wrapDekWithWalletSignature,
} from "./wallet-vault";
import { evaluatePrf } from "./webauthn-prf";

export interface PasskeyEnrollmentContext {
  credentialId: string;
  userId: string;
  prfOutput: Uint8Array;
  prfSalt: Uint8Array;
}

export interface OpaqueEnrollmentContext {
  userId: string;
  exportKey: Uint8Array;
}

export interface WalletEnrollmentContext {
  userId: string;
  address: string;
  chainId: number;
  signatureBytes: Uint8Array;
  signedAt: number;
  expiresAt: number;
}

export type EnrollmentCredential =
  | { type: "passkey"; context: PasskeyEnrollmentContext }
  | { type: "opaque"; context: OpaqueEnrollmentContext }
  | { type: "wallet"; context: WalletEnrollmentContext };

const ENVELOPE_FORMAT_METADATA_KEY = "envelopeFormat";
const PASSKEY_CACHE_TTL_MS = 15 * 60 * 1000;
const OPAQUE_CACHE_TTL_MS = 15 * 60 * 1000;

interface CachedPasskeyUnlock {
  credentialId: string;
  prfOutput: Uint8Array;
  cachedAt: number;
}

interface CachedOpaqueExport {
  userId: string;
  exportKey: Uint8Array;
  cachedAt: number;
}

let cachedUnlock: CachedPasskeyUnlock | null = null;
let pendingUnlock: Promise<CachedPasskeyUnlock> | null = null;
let pendingUnlockKey: string | null = null;
let cachedRecoveryKey: { keyId: string; cryptoKey: CryptoKey } | null = null;
let cachedOpaqueExport: CachedOpaqueExport | null = null;

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

/**
 * Cache the OPAQUE export key after successful sign-in.
 * This enables secret retrieval for password-only users.
 */
export function cacheOpaqueExportKey(params: {
  userId: string;
  exportKey: Uint8Array;
}): void {
  cachedOpaqueExport = {
    userId: params.userId,
    exportKey: params.exportKey,
    cachedAt: Date.now(),
  };
}

/**
 * Get cached OPAQUE export key if valid and matches userId.
 */
export function getCachedOpaqueExportKey(userId: string): Uint8Array | null {
  if (!cachedOpaqueExport) {
    return null;
  }
  if (Date.now() - cachedOpaqueExport.cachedAt > OPAQUE_CACHE_TTL_MS) {
    cachedOpaqueExport = null;
    return null;
  }
  if (cachedOpaqueExport.userId !== userId) {
    return null;
  }
  return cachedOpaqueExport.exportKey;
}

/**
 * Clear the OPAQUE export key cache.
 */
function resetOpaqueExportCache(): void {
  cachedOpaqueExport = null;
}

/**
 * Clear the cached recovery encryption key.
 */
function clearCachedRecoveryKey(): void {
  cachedRecoveryKey = null;
}

/**
 * Clear all cached crypto materials.
 * SECURITY: Call on sign-out to ensure no sensitive key material persists.
 */
export function clearAllCaches(): void {
  resetPasskeyUnlockCache();
  resetOpaqueExportCache();
  resetWalletSignatureCache();
  clearCachedRecoveryKey();
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

/**
 * Check if OPAQUE export key cache is fresh without retrieving the key.
 * Used to verify cache validity before starting multi-step verification flows.
 */
export function isOpaqueCacheFresh(userId: string): boolean {
  if (!cachedOpaqueExport) {
    return false;
  }
  if (Date.now() - cachedOpaqueExport.cachedAt > OPAQUE_CACHE_TTL_MS) {
    cachedOpaqueExport = null;
    return false;
  }
  return cachedOpaqueExport.userId === userId;
}

/**
 * Get cached passkey PRF output if valid and matches one of the allowed credential IDs.
 * Use this for binding secret derivation to avoid prompting the user again.
 */
export function getCachedPasskeyPrfOutput(
  allowedCredentialIds: string[]
): Uint8Array | null {
  const cached = getCachedUnlock(allowedCredentialIds);
  return cached?.prfOutput ?? null;
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

  const pendingKey = [...credentialIds]
    .sort((a, b) => a.localeCompare(b))
    .join("|");
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

function readEnvelopeFormat(
  metadata: Record<string, unknown> | null | undefined
): EnvelopeFormat | null {
  const value = metadata?.[ENVELOPE_FORMAT_METADATA_KEY];
  return value === "json" || value === "msgpack" ? value : null;
}

function mergeSecretMetadata(params: {
  envelopeFormat: EnvelopeFormat;
  metadata?: Record<string, unknown> | null;
}): Record<string, unknown> {
  return {
    ...params.metadata,
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

/**
 * Store a secret encrypted with a credential-derived KEK.
 * Supports passkey (PRF), OPAQUE password, and wallet (EIP-712) credential types.
 */
export async function storeSecretWithCredential(params: {
  secretType: SecretType;
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
  let kekSource: "prf" | "opaque" | "wallet" | "recovery";

  if (params.credential.type === "passkey") {
    const ctx = params.credential.context;
    wrappedDek = await wrapDekWithPrf({
      secretId,
      credentialId: ctx.credentialId,
      userId: ctx.userId,
      dek,
      prfOutput: ctx.prfOutput,
    });
    credentialId = ctx.credentialId;
    prfSalt = bytesToBase64(ctx.prfSalt);
    kekSource = "prf";
  } else if (params.credential.type === "opaque") {
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
  } else {
    // Wallet credential
    const ctx = params.credential.context;
    wrappedDek = await wrapDekWithWalletSignature({
      secretId,
      userId: ctx.userId,
      address: ctx.address,
      chainId: ctx.chainId,
      dek,
      signatureBytes: ctx.signatureBytes,
    });
    credentialId = getWalletCredentialId({
      address: ctx.address,
      chainId: ctx.chainId,
    });
    prfSalt = ""; // Wallet doesn't use PRF salt
    kekSource = "wallet";

    // Also cache the signature for later retrieval
    cacheWalletSig({
      userId: ctx.userId,
      address: ctx.address,
      chainId: ctx.chainId,
      signatureBytes: ctx.signatureBytes,
      signedAt: ctx.signedAt,
      expiresAt: ctx.expiresAt,
    });
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

interface SecretLoadContext {
  secretId: string;
  secretType: SecretType;
  encryptedBlob: Uint8Array;
  metadata: Record<string, unknown> | null;
  envelopeFormat: EnvelopeFormat;
  label: string;
}

interface SecretLoadResult {
  secretId: string;
  plaintext: Uint8Array;
  metadata: Record<string, unknown> | null;
  envelopeFormat: EnvelopeFormat;
}

interface SecretWrapper {
  credentialId: string;
  wrappedDek: string;
  prfSalt?: string | null;
}

async function resolveUserId(
  providedUserId: string | undefined,
  errorLabel: string
): Promise<string> {
  const userId =
    providedUserId ?? (await authClient.getSession()).data?.user?.id;
  if (!userId) {
    throw new Error(`Please sign in to access your ${errorLabel}.`);
  }
  return userId;
}

async function tryLoadWithPrf(
  ctx: SecretLoadContext,
  wrappers: SecretWrapper[],
  providedUserId: string | undefined
): Promise<SecretLoadResult | null> {
  const prfWrappers = wrappers.filter((w) => w.prfSalt);
  if (prfWrappers.length === 0) {
    return null;
  }

  const userId = await resolveUserId(providedUserId, ctx.label);

  const saltByCredential: Record<string, Uint8Array> = {};
  for (const wrapper of prfWrappers) {
    if (wrapper.prfSalt) {
      saltByCredential[wrapper.credentialId] = base64ToBytes(wrapper.prfSalt);
    }
  }

  const { credentialId: unlockedCredentialId, prfOutput } =
    await resolvePasskeyUnlock({ credentialIdToSalt: saltByCredential });

  const selectedWrapper = prfWrappers.find(
    (w) => w.credentialId === unlockedCredentialId
  );
  if (!selectedWrapper) {
    throw new Error("Selected passkey is not registered for this secret.");
  }

  const plaintext = await decryptSecretEnvelope({
    secretId: ctx.secretId,
    secretType: ctx.secretType,
    encryptedBlob: ctx.encryptedBlob,
    wrappedDek: selectedWrapper.wrappedDek,
    credentialId: selectedWrapper.credentialId,
    userId,
    prfOutput,
    envelopeFormat: ctx.envelopeFormat,
  });

  return {
    secretId: ctx.secretId,
    plaintext,
    metadata: ctx.metadata,
    envelopeFormat: ctx.envelopeFormat,
  };
}

async function tryLoadWithOpaque(
  ctx: SecretLoadContext,
  wrappers: SecretWrapper[],
  providedUserId: string | undefined
): Promise<SecretLoadResult | null> {
  const opaqueWrapper = wrappers.find(
    (w) => w.credentialId === OPAQUE_CREDENTIAL_ID
  );
  if (!opaqueWrapper) {
    return null;
  }

  if (!cachedOpaqueExport) {
    throw new Error(
      `Please sign in again to access your ${ctx.label}. Your session key has expired.`
    );
  }

  const userId =
    providedUserId ?? (await authClient.getSession()).data?.user?.id;
  if (!userId) {
    throw new Error(
      `Please sign in again to access your ${ctx.label}. Your session key has expired.`
    );
  }

  if (cachedOpaqueExport.userId !== userId) {
    resetOpaqueExportCache();
    throw new Error(
      `Please sign in again to access your ${ctx.label}. Your session key has expired.`
    );
  }

  const exportKey = getCachedOpaqueExportKey(userId);
  if (!exportKey) {
    throw new Error(
      `Please sign in again to access your ${ctx.label}. Your session key has expired.`
    );
  }

  const plaintext = await decryptSecretWithOpaqueExport({
    secretId: ctx.secretId,
    secretType: ctx.secretType,
    userId,
    encryptedBlob: ctx.encryptedBlob,
    wrappedDek: opaqueWrapper.wrappedDek,
    exportKey,
    envelopeFormat: ctx.envelopeFormat,
  });

  return {
    secretId: ctx.secretId,
    plaintext,
    metadata: ctx.metadata,
    envelopeFormat: ctx.envelopeFormat,
  };
}

async function tryLoadWithWallet(
  ctx: SecretLoadContext,
  wrappers: SecretWrapper[],
  providedUserId: string | undefined
): Promise<SecretLoadResult | null> {
  const walletWrapper = wrappers.find((w) =>
    w.credentialId.startsWith(WALLET_CREDENTIAL_PREFIX)
  );
  if (!walletWrapper) {
    return null;
  }

  const parsed = parseWalletCredentialId(walletWrapper.credentialId);
  if (!parsed) {
    throw new Error(
      `Invalid wallet credential format. Please re-secure your ${ctx.label}.`
    );
  }

  const userId = await resolveUserId(providedUserId, ctx.label);
  const signatureBytes = getCachedWalletSignature(
    userId,
    parsed.address,
    parsed.chainId
  );

  if (!signatureBytes) {
    throw new Error(
      `Please sign the key access request with your wallet to access your ${ctx.label}.`
    );
  }

  const plaintext = await decryptSecretWithWalletSignature({
    secretId: ctx.secretId,
    secretType: ctx.secretType,
    userId,
    address: parsed.address,
    chainId: parsed.chainId,
    encryptedBlob: ctx.encryptedBlob,
    wrappedDek: walletWrapper.wrappedDek,
    signatureBytes,
    envelopeFormat: ctx.envelopeFormat,
  });

  return {
    secretId: ctx.secretId,
    plaintext,
    metadata: ctx.metadata,
    envelopeFormat: ctx.envelopeFormat,
  };
}

export async function loadSecret(params: {
  secretType: SecretType;
  expectedEnvelopeFormat?: EnvelopeFormat;
  secretLabel?: string;
  userId?: string;
}): Promise<SecretLoadResult | null> {
  const bundle = await trpc.secrets.getSecretBundle.query({
    secretType: params.secretType,
  });

  if (!bundle?.secret) {
    return null;
  }

  const label = params.secretLabel ?? "secret";

  if (!bundle.wrappers?.length) {
    throw new Error(`No credentials are registered for this ${label}.`);
  }

  if (!bundle.secret.blobRef) {
    throw new Error(`Encrypted ${label} blob is missing.`);
  }

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

  const encryptedBlob = await downloadSecretBlob(bundle.secret.id);

  const ctx: SecretLoadContext = {
    secretId: bundle.secret.id,
    secretType: params.secretType,
    encryptedBlob,
    metadata: bundle.secret.metadata,
    envelopeFormat,
    label,
  };

  // Try credential types in priority order: PRF (passkey) > OPAQUE (password) > Wallet
  const prfResult = await tryLoadWithPrf(ctx, bundle.wrappers, params.userId);
  if (prfResult) {
    return prfResult;
  }

  const opaqueResult = await tryLoadWithOpaque(
    ctx,
    bundle.wrappers,
    params.userId
  );
  if (opaqueResult) {
    return opaqueResult;
  }

  const walletResult = await tryLoadWithWallet(
    ctx,
    bundle.wrappers,
    params.userId
  );
  if (walletResult) {
    return walletResult;
  }

  throw new Error(`No credentials are registered for this ${label}.`);
}

export async function addWrapperForSecretType(params: {
  secretType: SecretType;
  newCredentialId: string;
  newPrfOutput: Uint8Array;
  newPrfSalt: Uint8Array;
  /**
   * Required when the secret is only protected by an OPAQUE wrapper.
   * Used to unwrap the DEK with the current password session key.
   */
  userId?: string;
  opaqueExportKey?: Uint8Array;
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
    const opaqueWrapper = bundle.wrappers.find(
      (w) => w.credentialId === OPAQUE_CREDENTIAL_ID
    );
    if (!opaqueWrapper) {
      throw new Error("No credentials are registered for this secret.");
    }

    const userId =
      params.userId ?? (await authClient.getSession()).data?.user?.id ?? null;
    if (!(userId && params.opaqueExportKey)) {
      throw new Error(
        "Please sign in again with your password to add a passkey to this secret."
      );
    }

    const dek = await unwrapDekWithOpaqueExport({
      secretId: bundle.secret.id,
      userId,
      wrappedDek: opaqueWrapper.wrappedDek,
      exportKey: params.opaqueExportKey,
    });

    const wrappedDek = await wrapDekWithPrf({
      secretId: bundle.secret.id,
      credentialId: params.newCredentialId,
      userId,
      dek,
      prfOutput: params.newPrfOutput,
    });

    await trpc.secrets.addWrapper.mutate({
      secretId: bundle.secret.id,
      secretType: params.secretType,
      credentialId: params.newCredentialId,
      wrappedDek,
      prfSalt: bytesToBase64(params.newPrfSalt),
      kekSource: "prf",
    });

    return true;
  }

  // Get userId for PRF wrapper AAD
  const prfUserId =
    params.userId ?? (await authClient.getSession()).data?.user?.id;
  if (!prfUserId) {
    throw new Error("Please sign in to add a passkey wrapper.");
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
    userId: prfUserId,
    wrappedDek: selectedWrapper.wrappedDek,
    prfOutput: selectedOutput,
  });

  const wrappedDek = await wrapDekWithPrf({
    secretId: bundle.secret.id,
    credentialId: params.newCredentialId,
    userId: prfUserId,
    dek,
    prfOutput: params.newPrfOutput,
  });

  await trpc.secrets.addWrapper.mutate({
    secretId: bundle.secret.id,
    secretType: params.secretType,
    credentialId: params.newCredentialId,
    wrappedDek,
    prfSalt: bytesToBase64(params.newPrfSalt),
    kekSource: "prf",
  });

  return true;
}

export async function addRecoveryWrapperForSecretType(params: {
  secretType: SecretType;
}): Promise<boolean> {
  const bundle = await trpc.secrets.getSecretBundle.query({
    secretType: params.secretType,
  });

  if (!(bundle.secret && bundle.wrappers?.length)) {
    return false;
  }

  // Get userId for PRF wrapper AAD
  const userId = (await authClient.getSession()).data?.user?.id;
  if (!userId) {
    throw new Error("Please sign in to add a recovery wrapper.");
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

  const dek = await unwrapDekWithPrf({
    secretId: bundle.secret.id,
    credentialId: selectedWrapper.credentialId,
    userId,
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
  secretType: SecretType;
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
    userId: params.userId,
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
    kekSource: opaqueWrapper.kekSource,
  });

  return true;
}

/**
 * Update OPAQUE wrapper after password change.
 * The old export key is used to unwrap, and new export key re-wraps the DEK.
 */
export async function updateOpaqueWrapperForSecretType(params: {
  secretType: SecretType;
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
    kekSource: newWrapper.kekSource,
  });

  return true;
}
