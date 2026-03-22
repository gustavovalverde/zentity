"use client";

/**
 * Secrets Module
 *
 * Main API for storing and loading credential-encrypted secrets.
 * Supports passkey (PRF), OPAQUE (password), and wallet (EIP-712) credentials.
 *
 * Credential material is NEVER cached — each operation prompts for fresh material.
 */

import type { EnrollmentCredential, EnvelopeFormat, SecretType } from "./types";

import { authClient } from "@/lib/auth/auth-client";
import { evaluatePrf } from "@/lib/auth/webauthn-prf";
import {
  clearPendingUnlock,
  createOpaqueWrapper,
  getCachedRecoveryPublicKey,
  getPendingUnlock,
  getWalletCredentialId,
  OPAQUE_CREDENTIAL_ID,
  setCachedRecoveryPublicKey,
  setPendingUnlock,
  unwrapDekWithOpaqueExport,
  unwrapDekWithPrf,
  unwrapDekWithWalletSignature,
  WALLET_CREDENTIAL_PREFIX,
  wrapDekWithOpaqueExport,
  wrapDekWithPrf,
  wrapDekWithWalletSignature,
} from "@/lib/privacy/credentials";
import { encodeAad, RECOVERY_AAD_CONTEXT } from "@/lib/privacy/primitives/aad";
import { mlKemEncapsulate } from "@/lib/privacy/primitives/ml-kem";
import { trpc } from "@/lib/trpc/client";
import { base64ToBytes, bytesToBase64 } from "@/lib/utils/base64";

import { decryptWithDek, encryptWithDek, generateDek } from "./envelope";
import { downloadSecretBlob, uploadSecretBlob } from "./storage";

// Re-export types
export type { EnrollmentCredential } from "./types";

const ENVELOPE_FORMAT_METADATA_KEY = "envelopeFormat";

interface ResolvedPasskeyUnlock {
  credentialId: string;
  prfOutput: Uint8Array;
}

async function resolvePasskeyUnlock(params: {
  credentialIdToSalt: Record<string, Uint8Array>;
  credentialTransports?: Record<string, AuthenticatorTransport[]> | undefined;
}): Promise<ResolvedPasskeyUnlock> {
  const credentialIds = Object.keys(params.credentialIdToSalt);
  if (credentialIds.length === 0) {
    throw new Error("No passkeys are registered for this secret.");
  }

  // Deduplicate concurrent WebAuthn prompts (not a time-based cache)
  const pendingKey = [...credentialIds]
    .sort((a, b) => a.localeCompare(b))
    .join("|");
  const pending = getPendingUnlock();
  if (pending?.key === pendingKey) {
    return pending.promise;
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

    return {
      credentialId: resolvedCredentialId,
      prfOutput,
    };
  })();

  setPendingUnlock(pendingKey, unlockPromise);

  try {
    return await unlockPromise;
  } finally {
    clearPendingUnlock(unlockPromise);
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
  metadata?: Record<string, unknown> | null | undefined;
}): Record<string, unknown> {
  return {
    ...params.metadata,
    [ENVELOPE_FORMAT_METADATA_KEY]: params.envelopeFormat,
  };
}

async function getRecoveryPublicKeyBytes(): Promise<{
  keyId: string;
  publicKey: Uint8Array;
}> {
  const cached = getCachedRecoveryPublicKey();
  if (cached) {
    return cached;
  }

  const { keyId, publicKey: publicKeyBase64 } =
    await trpc.recovery.publicKey.query();
  const publicKey = base64ToBytes(publicKeyBase64);

  setCachedRecoveryPublicKey({ keyId, publicKey });
  return { keyId, publicKey };
}

async function encryptDekForRecovery(params: {
  dek: Uint8Array;
  secretId: string;
  userId: string;
}): Promise<{
  wrappedDek: string;
  keyId: string;
}> {
  const { keyId, publicKey } = await getRecoveryPublicKeyBytes();

  const { cipherText, sharedSecret } = mlKemEncapsulate(publicKey);

  const aesKey = await crypto.subtle.importKey(
    "raw",
    Uint8Array.from(sharedSecret).buffer,
    "AES-GCM",
    false,
    ["encrypt"]
  );

  const aad = encodeAad([RECOVERY_AAD_CONTEXT, params.secretId, params.userId]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: Uint8Array.from(aad).buffer,
    },
    aesKey,
    Uint8Array.from(params.dek).buffer
  );

  const envelope = {
    alg: "ML-KEM-768",
    kemCipherText: bytesToBase64(cipherText),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(encrypted)),
  };

  return { wrappedDek: JSON.stringify(envelope), keyId };
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
  metadata?: Record<string, unknown> | null | undefined;
  baseCommitment?: string | undefined;
}): Promise<{ secretId: string; envelopeFormat: EnvelopeFormat }> {
  const secretId = crypto.randomUUID();
  const dek = generateDek();
  const envelope = await encryptWithDek({
    secretId,
    secretType: params.secretType,
    plaintext: params.plaintext,
    dek,
    envelopeFormat: params.envelopeFormat,
  });

  let wrappedDek: string;
  let credentialId: string;
  let prfSalt: string | undefined;
  let kekSource: "prf" | "opaque" | "wallet" | "recovery";

  if (params.credential.type === "passkey") {
    const ctx = params.credential.context;
    wrappedDek = await wrapDekWithPrf({
      secretId,
      credentialId: ctx.credentialId,
      userId: ctx.userId,
      dek,
      prfOutput: ctx.prfOutput,
      prfSalt: ctx.prfSalt,
    });
    credentialId = ctx.credentialId;
    prfSalt = bytesToBase64(ctx.prfSalt);
    kekSource = "prf";
  } else if (params.credential.type === "opaque") {
    const ctx = params.credential.context;
    wrappedDek = await wrapDekWithOpaqueExport({
      secretId,
      userId: ctx.userId,
      dek,
      exportKey: ctx.exportKey,
    });
    credentialId = OPAQUE_CREDENTIAL_ID;
    prfSalt = undefined;
    kekSource = "opaque";
  } else {
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
    prfSalt = undefined;
    kekSource = "wallet";
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
    ...(prfSalt ? { prfSalt } : {}),
    credentialId,
    kekSource,
    metadata: mergeSecretMetadata({
      envelopeFormat: params.envelopeFormat,
      metadata: params.metadata,
    }),
    baseCommitment: params.baseCommitment,
  });

  try {
    const recovery = await encryptDekForRecovery({
      dek,
      secretId,
      userId: params.credential.context.userId,
    });
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
  encryptedBlob: Uint8Array;
  envelopeFormat: EnvelopeFormat;
  label: string;
  metadata: Record<string, unknown> | null;
  secretId: string;
  secretType: SecretType;
}

interface SecretLoadResult {
  envelopeFormat: EnvelopeFormat;
  metadata: Record<string, unknown> | null;
  plaintext: Uint8Array;
  secretId: string;
}

interface SecretWrapper {
  credentialId: string;
  prfSalt?: string | null;
  wrappedDek: string;
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

function requireCredentialPrfSalt(
  saltByCredential: Record<string, Uint8Array>,
  credentialId: string
): Uint8Array {
  const salt = saltByCredential[credentialId];
  if (!salt) {
    throw new Error("Selected passkey salt is missing.");
  }
  return salt;
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
    await resolvePasskeyUnlock({
      credentialIdToSalt: saltByCredential,
    });

  const selectedWrapper = prfWrappers.find(
    (w) => w.credentialId === unlockedCredentialId
  );
  if (!selectedWrapper) {
    throw new Error("Selected passkey is not registered for this secret.");
  }

  const dek = await unwrapDekWithPrf({
    secretId: ctx.secretId,
    credentialId: selectedWrapper.credentialId,
    userId,
    wrappedDek: selectedWrapper.wrappedDek,
    prfOutput,
    prfSalt: requireCredentialPrfSalt(
      saltByCredential,
      selectedWrapper.credentialId
    ),
  });

  const plaintext = await decryptWithDek({
    secretId: ctx.secretId,
    secretType: ctx.secretType,
    encryptedBlob: ctx.encryptedBlob,
    dek,
    envelopeFormat: ctx.envelopeFormat,
  });

  return {
    secretId: ctx.secretId,
    plaintext,
    metadata: ctx.metadata,
    envelopeFormat: ctx.envelopeFormat,
  };
}

/**
 * Load a secret by type, automatically selecting the appropriate credential.
 * Passkey wrappers trigger a WebAuthn prompt. OPAQUE/wallet wrappers throw
 * requesting the caller to re-authenticate (credential material is never cached).
 */
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

  const encryptedBlob = await downloadSecretBlob(bundle.secret.id, {
    expectedHash: bundle.secret.blobHash,
  });

  const ctx: SecretLoadContext = {
    secretId: bundle.secret.id,
    secretType: params.secretType,
    encryptedBlob,
    metadata: bundle.secret.metadata,
    envelopeFormat,
    label,
  };

  // Passkey wrappers: prompt via WebAuthn
  const prfWrappers = bundle.wrappers.filter((w) => w.prfSalt);
  if (prfWrappers.length > 0) {
    const prfResult = await tryLoadWithPrf(ctx, bundle.wrappers, params.userId);
    if (prfResult) {
      return prfResult;
    }
  }

  // OPAQUE/wallet: credential material is never cached, throw requesting re-auth
  const walletWrapper = bundle.wrappers.find((w) =>
    w.credentialId.startsWith(WALLET_CREDENTIAL_PREFIX)
  );
  if (walletWrapper) {
    throw new Error(
      `Please sign the key access request with your wallet to access your ${label}.`
    );
  }

  const opaqueWrapper = bundle.wrappers.find(
    (w) => w.credentialId === OPAQUE_CREDENTIAL_ID
  );
  if (opaqueWrapper) {
    throw new Error(
      `Please sign in again to access your ${label}. Your session key has expired.`
    );
  }

  throw new Error(`No credentials are registered for this ${label}.`);
}

/**
 * Load a secret using explicitly provided credential material.
 * Unlike `loadSecret` (which auto-prompts for passkey or throws for wallet/OPAQUE),
 * this accepts credential material directly — enabling wallet and OPAQUE unlock flows.
 */
export async function loadSecretWithCredential(params: {
  secretType: SecretType;
  expectedEnvelopeFormat?: EnvelopeFormat;
  secretLabel?: string;
  userId?: string;
  credential:
    | { type: "opaque"; exportKey: Uint8Array }
    | {
        type: "wallet";
        address: string;
        chainId: number;
        signatureBytes: Uint8Array;
      };
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

  const encryptedBlob = await downloadSecretBlob(bundle.secret.id, {
    expectedHash: bundle.secret.blobHash,
  });

  const userId = await resolveUserId(params.userId, label);

  let dek: Uint8Array;

  if (params.credential.type === "opaque") {
    const opaqueWrapper = bundle.wrappers.find(
      (w) => w.credentialId === OPAQUE_CREDENTIAL_ID
    );
    if (!opaqueWrapper) {
      throw new Error(`No OPAQUE credential registered for this ${label}.`);
    }
    dek = await unwrapDekWithOpaqueExport({
      secretId: bundle.secret.id,
      userId,
      wrappedDek: opaqueWrapper.wrappedDek,
      exportKey: params.credential.exportKey,
    });
  } else {
    const walletCredId = getWalletCredentialId({
      address: params.credential.address,
      chainId: params.credential.chainId,
    });
    const walletWrapper = bundle.wrappers.find(
      (w) => w.credentialId === walletCredId
    );
    if (!walletWrapper) {
      throw new Error(`No wallet credential registered for this ${label}.`);
    }
    dek = await unwrapDekWithWalletSignature({
      secretId: bundle.secret.id,
      userId,
      address: params.credential.address,
      chainId: params.credential.chainId,
      wrappedDek: walletWrapper.wrappedDek,
      signatureBytes: params.credential.signatureBytes,
    });
  }

  const plaintext = await decryptWithDek({
    secretId: bundle.secret.id,
    secretType: params.secretType,
    encryptedBlob,
    dek,
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
 * Add a new passkey wrapper for an existing secret.
 */
export async function addWrapperForSecretType(params: {
  secretType: SecretType;
  newCredentialId: string;
  newPrfOutput: Uint8Array;
  newPrfSalt: Uint8Array;
  userId?: string | undefined;
  opaqueExportKey?: Uint8Array | undefined;
}): Promise<boolean> {
  const bundle = await trpc.secrets.getSecretBundle.query({
    secretType: params.secretType,
  });

  if (!(bundle.secret && bundle.wrappers?.length)) {
    return false;
  }

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
      prfSalt: params.newPrfSalt,
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
    prfSalt: requireCredentialPrfSalt(
      saltByCredential,
      selectedWrapper.credentialId
    ),
  });

  const wrappedDek = await wrapDekWithPrf({
    secretId: bundle.secret.id,
    credentialId: params.newCredentialId,
    userId: prfUserId,
    dek,
    prfOutput: params.newPrfOutput,
    prfSalt: params.newPrfSalt,
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

/**
 * Add a recovery wrapper using the current user's passkey.
 */
export async function addRecoveryWrapperForSecretType(params: {
  secretType: SecretType;
}): Promise<boolean> {
  const bundle = await trpc.secrets.getSecretBundle.query({
    secretType: params.secretType,
  });

  if (!(bundle.secret && bundle.wrappers?.length)) {
    return false;
  }

  const userId = (await authClient.getSession()).data?.user?.id;
  if (!userId) {
    throw new Error("Please sign in to add a recovery wrapper.");
  }

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
    prfSalt: requireCredentialPrfSalt(
      saltByCredential,
      selectedWrapper.credentialId
    ),
  });

  const recovery = await encryptDekForRecovery({
    dek,
    secretId: bundle.secret.id,
    userId,
  });

  await trpc.recovery.storeSecretWrapper.mutate({
    secretId: bundle.secret.id,
    wrappedDek: recovery.wrappedDek,
    keyId: recovery.keyId,
  });

  return true;
}

/**
 * Add an OPAQUE wrapper using the current user's passkey to unwrap.
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

  const existingOpaqueWrapper = bundle.wrappers.find(
    (w) => w.credentialId === OPAQUE_CREDENTIAL_ID
  );
  if (existingOpaqueWrapper) {
    return true;
  }

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

  const dek = await unwrapDekWithPrf({
    secretId: bundle.secret.id,
    credentialId: selectedWrapper.credentialId,
    userId: params.userId,
    wrappedDek: selectedWrapper.wrappedDek,
    prfOutput,
    prfSalt: requireCredentialPrfSalt(
      saltByCredential,
      selectedWrapper.credentialId
    ),
  });

  const opaqueWrapper = await createOpaqueWrapper({
    secretId: bundle.secret.id,
    userId: params.userId,
    dek,
    exportKey: params.exportKey,
  });

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

  const existingWrapper = bundle.wrappers.find(
    (w) => w.credentialId === OPAQUE_CREDENTIAL_ID
  );

  if (!existingWrapper) {
    return addOpaqueWrapperForSecretType({
      secretType: params.secretType,
      userId: params.userId,
      exportKey: params.newExportKey,
    });
  }

  const dek = await unwrapDekWithOpaqueExport({
    secretId: bundle.secret.id,
    userId: params.userId,
    wrappedDek: existingWrapper.wrappedDek,
    exportKey: params.oldExportKey,
  });

  const newWrapper = await createOpaqueWrapper({
    secretId: bundle.secret.id,
    userId: params.userId,
    dek,
    exportKey: params.newExportKey,
  });

  await trpc.secrets.addWrapper.mutate({
    secretId: bundle.secret.id,
    secretType: params.secretType,
    credentialId: newWrapper.credentialId,
    wrappedDek: newWrapper.wrappedDek,
    kekSource: newWrapper.kekSource,
  });

  return true;
}
