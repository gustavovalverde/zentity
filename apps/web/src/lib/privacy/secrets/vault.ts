"use client";

/**
 * Vault Module
 *
 * The vault is the set of a user's encrypted secrets. The root secret's DEK
 * (the vault key) is wrapped once per unlocking credential: passkey PRF,
 * OPAQUE export key, wallet EIP-712 signature, or recovery key. Every other
 * secret's DEK is wrapped under a KEK derived from the vault key, so any
 * unlocking credential opens every secret, including ones stored after the
 * credential was added.
 *
 * Credential material is NEVER cached — each operation prompts for fresh material.
 */

import type {
  EnrollmentCredential,
  EnvelopeFormat,
  SecretType,
  UnlockingKekSource,
} from "./catalog";

import { authClient } from "@/lib/auth/auth-client";
import { evaluatePrf } from "@/lib/auth/passkey/prf";
import {
  clearPendingUnlock,
  getPendingUnlock,
  setPendingUnlock,
} from "@/lib/privacy/credentials/cache";
import { deriveKekFromVaultKey } from "@/lib/privacy/credentials/derivation";
import {
  unwrapDekWithOpaqueExport,
  wrapDekWithOpaqueExport,
} from "@/lib/privacy/credentials/opaque";
import {
  unwrapDekWithPrf,
  wrapDekWithPrf,
} from "@/lib/privacy/credentials/passkey";
import {
  unwrapDekWithRecoveryKey,
  wrapDekWithRecoveryKey,
} from "@/lib/privacy/credentials/recovery-key";
import {
  getWalletCredentialId,
  unwrapDekWithWalletSignature,
  WALLET_CREDENTIAL_PREFIX,
  wrapDekWithWalletSignature,
} from "@/lib/privacy/credentials/wallet";
import { unwrapDek, wrapDek } from "@/lib/privacy/credentials/wrap";
import {
  base64ToBytes,
  bytesToBase64,
} from "@/lib/privacy/primitives/symmetric";
import { trpc } from "@/lib/trpc/client";

import {
  OPAQUE_CREDENTIAL_ID,
  RECOVERY_KEY_CREDENTIAL_ID,
  SECRET_TYPES,
  VAULT_KEY_CREDENTIAL_ID,
  VAULT_ROOT_SECRET_TYPE,
} from "./catalog";
import { decryptWithDek, encryptWithDek, generateDek } from "./envelope";
import { downloadSecretBlob, uploadSecretBlob } from "./storage";

export type { EnrollmentCredential } from "./catalog";

const ENVELOPE_FORMAT_METADATA_KEY = "envelopeFormat";

/**
 * Credential material that can wrap or unwrap the vault key.
 */
export type VaultCredentialMaterial =
  | {
      type: "passkey";
      credentialId: string;
      prfOutput: Uint8Array;
      prfSalt: Uint8Array;
    }
  | { type: "opaque"; exportKey: Uint8Array }
  | {
      type: "wallet";
      address: string;
      chainId: number;
      signatureBytes: Uint8Array;
    }
  | { type: "recovery_key"; recoveryKey: Uint8Array };

/**
 * How to unlock the vault: explicit credential material, or a WebAuthn
 * prompt over the vault's passkey wrappers (optionally narrowed).
 */
export type VaultUnlock =
  | VaultCredentialMaterial
  | { type: "passkey_prompt"; credentialIds?: readonly string[] };

export interface VaultKey {
  key: Uint8Array;
  secretId: string;
  unlockedWith: string;
  userId: string;
}

interface SecretWrapper {
  credentialId: string;
  prfSalt?: string | null;
  wrappedDek: string;
}

interface SecretBundle {
  secret: {
    blobHash: string | null;
    blobRef: string | null;
    id: string;
    metadata: Record<string, unknown> | null;
  } | null;
  wrappers: SecretWrapper[];
}

interface SecretLoadResult {
  envelopeFormat: EnvelopeFormat;
  metadata: Record<string, unknown> | null;
  plaintext: Uint8Array;
  secretId: string;
}

interface SecretReadOptions {
  expectedEnvelopeFormat?: EnvelopeFormat | undefined;
  secretLabel?: string | undefined;
  secretType: SecretType;
}

function getSecretBundle(secretType: SecretType): Promise<SecretBundle> {
  return trpc.secrets.getSecretBundle.query({ secretType });
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

async function resolvePasskeyUnlock(
  credentialIdToSalt: Record<string, Uint8Array>
): Promise<{ credentialId: string; prfOutput: Uint8Array }> {
  const credentialIds = Object.keys(credentialIdToSalt);
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
      credentialIdToSalt,
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
      throw new Error(
        "Your passkey didn't return the expected data. Please try again or use a different sign-in method."
      );
    }

    return { credentialId: resolvedCredentialId, prfOutput };
  })();

  setPendingUnlock(pendingKey, unlockPromise);

  try {
    return await unlockPromise;
  } finally {
    clearPendingUnlock(unlockPromise);
  }
}

function vaultCredentialId(material: VaultCredentialMaterial): string {
  switch (material.type) {
    case "passkey":
      return material.credentialId;
    case "opaque":
      return OPAQUE_CREDENTIAL_ID;
    case "wallet":
      return getWalletCredentialId(material);
    case "recovery_key":
      return RECOVERY_KEY_CREDENTIAL_ID;
    default: {
      const _exhaustive: never = material;
      throw new Error("Unknown credential type");
    }
  }
}

function vaultKekSource(material: VaultCredentialMaterial): UnlockingKekSource {
  return material.type === "passkey" ? "prf" : material.type;
}

function wrapForCredential(
  material: VaultCredentialMaterial,
  target: { secretId: string; userId: string; dek: Uint8Array }
): Promise<string> {
  switch (material.type) {
    case "passkey":
      return wrapDekWithPrf({
        ...target,
        credentialId: material.credentialId,
        prfOutput: material.prfOutput,
        prfSalt: material.prfSalt,
      });
    case "opaque":
      return wrapDekWithOpaqueExport({
        ...target,
        exportKey: material.exportKey,
      });
    case "wallet":
      return wrapDekWithWalletSignature({
        ...target,
        address: material.address,
        chainId: material.chainId,
        signatureBytes: material.signatureBytes,
      });
    case "recovery_key":
      return wrapDekWithRecoveryKey({
        ...target,
        recoveryKey: material.recoveryKey,
      });
    default: {
      const _exhaustive: never = material;
      throw new Error("Unknown credential type");
    }
  }
}

function unwrapForCredential(
  material: VaultCredentialMaterial,
  source: { secretId: string; userId: string; wrappedDek: string }
): Promise<Uint8Array> {
  switch (material.type) {
    case "passkey":
      return unwrapDekWithPrf({
        ...source,
        credentialId: material.credentialId,
        prfOutput: material.prfOutput,
        prfSalt: material.prfSalt,
      });
    case "opaque":
      return unwrapDekWithOpaqueExport({
        ...source,
        exportKey: material.exportKey,
      });
    case "wallet":
      return unwrapDekWithWalletSignature({
        ...source,
        address: material.address,
        chainId: material.chainId,
        signatureBytes: material.signatureBytes,
      });
    case "recovery_key":
      return unwrapDekWithRecoveryKey({
        ...source,
        recoveryKey: material.recoveryKey,
      });
    default: {
      const _exhaustive: never = material;
      throw new Error("Unknown credential type");
    }
  }
}

const MISMATCH_MESSAGES: Record<VaultCredentialMaterial["type"], string> = {
  passkey: "This passkey can't open your encrypted data.",
  opaque: "This password can't open your encrypted data.",
  wallet: "This wallet signature can't open your encrypted data.",
  recovery_key:
    "This recovery key doesn't match your account. Check the words and try again.",
};

export function materialFromEnrollment(
  credential: EnrollmentCredential
): VaultCredentialMaterial {
  switch (credential.type) {
    case "passkey":
      return {
        type: "passkey",
        credentialId: credential.context.credentialId,
        prfOutput: credential.context.prfOutput,
        prfSalt: credential.context.prfSalt,
      };
    case "opaque":
      return { type: "opaque", exportKey: credential.context.exportKey };
    case "wallet":
      return {
        type: "wallet",
        address: credential.context.address,
        chainId: credential.context.chainId,
        signatureBytes: credential.context.signatureBytes,
      };
    default: {
      const _exhaustive: never = credential;
      throw new Error("Unknown credential type");
    }
  }
}

async function resolveUnlockMaterial(
  unlock: VaultUnlock,
  wrappers: SecretWrapper[]
): Promise<VaultCredentialMaterial> {
  if (unlock.type !== "passkey_prompt") {
    return unlock;
  }

  const saltByCredential: Record<string, Uint8Array> = {};
  for (const wrapper of wrappers) {
    if (
      wrapper.prfSalt &&
      (!unlock.credentialIds ||
        unlock.credentialIds.includes(wrapper.credentialId))
    ) {
      saltByCredential[wrapper.credentialId] = base64ToBytes(wrapper.prfSalt);
    }
  }

  const { credentialId, prfOutput } =
    await resolvePasskeyUnlock(saltByCredential);
  const prfSalt = saltByCredential[credentialId];
  if (!prfSalt) {
    throw new Error("Selected passkey is not registered for this secret.");
  }
  return { type: "passkey", credentialId, prfOutput, prfSalt };
}

/**
 * Unlock the vault key with a credential. Returns null when the user has no
 * vault yet.
 */
export async function unlockVaultKey(
  unlock: VaultUnlock,
  options: { userId?: string | undefined } = {}
): Promise<VaultKey | null> {
  const bundle = await getSecretBundle(VAULT_ROOT_SECRET_TYPE);
  if (!bundle.secret) {
    return null;
  }

  const userId = await resolveUserId(options.userId, "encrypted data");
  const material = await resolveUnlockMaterial(unlock, bundle.wrappers);
  const credentialId = vaultCredentialId(material);
  const wrapper = bundle.wrappers.find((w) => w.credentialId === credentialId);
  if (!wrapper) {
    throw new Error(MISMATCH_MESSAGES[material.type]);
  }

  let key: Uint8Array;
  try {
    key = await unwrapForCredential(material, {
      secretId: bundle.secret.id,
      userId,
      wrappedDek: wrapper.wrappedDek,
    });
  } catch {
    throw new Error(MISMATCH_MESSAGES[material.type]);
  }

  return {
    key,
    secretId: bundle.secret.id,
    unlockedWith: credentialId,
    userId,
  };
}

function readEnvelopeFormat(
  metadata: Record<string, unknown> | null | undefined
): EnvelopeFormat | null {
  const value = metadata?.[ENVELOPE_FORMAT_METADATA_KEY];
  return value === "json" || value === "msgpack" ? value : null;
}

function resolveEnvelopeFormat(
  metadata: Record<string, unknown> | null,
  options: SecretReadOptions,
  label: string
): EnvelopeFormat {
  const storedFormat = readEnvelopeFormat(metadata);
  if (
    storedFormat &&
    options.expectedEnvelopeFormat &&
    storedFormat !== options.expectedEnvelopeFormat
  ) {
    throw new Error(
      `Secret envelope format mismatch. Please re-secure your ${label}.`
    );
  }

  const envelopeFormat = storedFormat ?? options.expectedEnvelopeFormat;
  if (!envelopeFormat) {
    throw new Error(
      `Missing envelope format metadata. Please re-secure your ${label}.`
    );
  }
  return envelopeFormat;
}

async function resolveSecretDek(
  vaultKey: VaultKey,
  secretType: SecretType,
  bundle: SecretBundle & { secret: NonNullable<SecretBundle["secret"]> },
  label: string
): Promise<Uint8Array> {
  if (secretType === VAULT_ROOT_SECRET_TYPE) {
    if (bundle.secret.id !== vaultKey.secretId) {
      throw new Error(
        `Your ${label} changed while unlocking. Please try again.`
      );
    }
    return vaultKey.key;
  }

  const wrapper = bundle.wrappers.find(
    (w) => w.credentialId === VAULT_KEY_CREDENTIAL_ID
  );
  if (!wrapper) {
    throw new Error(`No credentials are registered for this ${label}.`);
  }

  const kek = await deriveKekFromVaultKey(vaultKey.key, vaultKey.userId);
  return unwrapDek({
    secretId: bundle.secret.id,
    credentialId: VAULT_KEY_CREDENTIAL_ID,
    userId: vaultKey.userId,
    wrappedDek: wrapper.wrappedDek,
    kek,
  });
}

/**
 * Decrypt one vault secret with an unlocked vault key.
 */
async function openVaultSecret(
  vaultKey: VaultKey,
  options: SecretReadOptions
): Promise<SecretLoadResult | null> {
  const bundle = await getSecretBundle(options.secretType);
  const secret = bundle.secret;
  if (!secret) {
    return null;
  }

  const label = options.secretLabel ?? "secret";
  if (!secret.blobRef) {
    throw new Error(`Encrypted ${label} blob is missing.`);
  }

  const envelopeFormat = resolveEnvelopeFormat(secret.metadata, options, label);
  const dek = await resolveSecretDek(
    vaultKey,
    options.secretType,
    { ...bundle, secret },
    label
  );
  const encryptedBlob = await downloadSecretBlob(secret.id, {
    expectedHash: secret.blobHash,
  });

  const plaintext = await decryptWithDek({
    secretId: secret.id,
    secretType: options.secretType,
    encryptedBlob,
    dek,
    envelopeFormat,
  });

  return {
    secretId: secret.id,
    plaintext,
    metadata: secret.metadata,
    envelopeFormat,
  };
}

/**
 * Store a secret. The root secret is wrapped for the given credential; any
 * other secret is wrapped under the vault key, which the credential unlocks.
 */
export async function storeSecretWithCredential(params: {
  secretType: SecretType;
  plaintext: Uint8Array;
  credential: EnrollmentCredential;
  envelopeFormat: EnvelopeFormat;
  metadata?: Record<string, unknown> | null | undefined;
}): Promise<{ secretId: string; envelopeFormat: EnvelopeFormat }> {
  const material = materialFromEnrollment(params.credential);
  const userId = params.credential.context.userId;
  const secretId = crypto.randomUUID();
  const dek = generateDek();

  let wrapper: {
    credentialId: string;
    kekSource: UnlockingKekSource | "vault";
    prfSalt?: string;
    wrappedDek: string;
  };

  if (params.secretType === VAULT_ROOT_SECRET_TYPE) {
    wrapper = {
      credentialId: vaultCredentialId(material),
      kekSource: vaultKekSource(material),
      wrappedDek: await wrapForCredential(material, { secretId, userId, dek }),
      ...(material.type === "passkey"
        ? { prfSalt: bytesToBase64(material.prfSalt) }
        : {}),
    };
  } else {
    const vaultKey = await unlockVaultKey(material, { userId });
    if (!vaultKey) {
      throw new Error("Set up your encryption keys before saving this data.");
    }
    const kek = await deriveKekFromVaultKey(vaultKey.key, userId);
    wrapper = {
      credentialId: VAULT_KEY_CREDENTIAL_ID,
      kekSource: "vault",
      wrappedDek: await wrapDek({
        secretId,
        credentialId: VAULT_KEY_CREDENTIAL_ID,
        userId,
        dek,
        kek,
      }),
    };
  }

  const envelope = await encryptWithDek({
    secretId,
    secretType: params.secretType,
    plaintext: params.plaintext,
    dek,
    envelopeFormat: params.envelopeFormat,
  });

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
    ...wrapper,
    metadata: {
      ...params.metadata,
      [ENVELOPE_FORMAT_METADATA_KEY]: params.envelopeFormat,
    },
  });

  return { secretId, envelopeFormat: params.envelopeFormat };
}

/**
 * Load a secret, prompting for a passkey when the vault has passkey
 * wrappers. OPAQUE/wallet-only vaults throw requesting re-authentication
 * (credential material is never cached).
 */
export async function loadSecret(
  params: SecretReadOptions & { userId?: string }
): Promise<SecretLoadResult | null> {
  const label = params.secretLabel ?? "secret";
  const [target, root] = await Promise.all([
    getSecretBundle(params.secretType),
    getSecretBundle(VAULT_ROOT_SECRET_TYPE),
  ]);
  if (!(target.secret && root.secret)) {
    return null;
  }

  if (root.wrappers.some((w) => w.prfSalt)) {
    const vaultKey = await unlockVaultKey(
      { type: "passkey_prompt" },
      { userId: params.userId }
    );
    return vaultKey ? openVaultSecret(vaultKey, params) : null;
  }

  if (
    root.wrappers.some((w) =>
      w.credentialId.startsWith(WALLET_CREDENTIAL_PREFIX)
    )
  ) {
    throw new Error(
      `Please sign the key access request with your wallet to access your ${label}.`
    );
  }

  if (root.wrappers.some((w) => w.credentialId === OPAQUE_CREDENTIAL_ID)) {
    throw new Error(
      `Please sign in again to access your ${label}. Your session key has expired.`
    );
  }

  throw new Error(`No credentials are registered for this ${label}.`);
}

/**
 * Load a secret using explicitly provided credential material.
 */
export async function loadSecretWithCredential(
  params: SecretReadOptions & {
    credential: VaultCredentialMaterial;
    userId?: string;
  }
): Promise<SecretLoadResult | null> {
  const vaultKey = await unlockVaultKey(params.credential, {
    userId: params.userId,
  });
  return vaultKey ? openVaultSecret(vaultKey, params) : null;
}

/**
 * Wrap the vault key for another credential. Replaces any existing wrapper
 * for the same credential.
 */
export async function addVaultCredential(
  vaultKey: VaultKey,
  material: VaultCredentialMaterial
): Promise<void> {
  const wrappedDek = await wrapForCredential(material, {
    secretId: vaultKey.secretId,
    userId: vaultKey.userId,
    dek: vaultKey.key,
  });

  await trpc.secrets.addWrapper.mutate({
    secretId: vaultKey.secretId,
    credentialId: vaultCredentialId(material),
    wrappedDek,
    kekSource: vaultKekSource(material),
    ...(material.type === "passkey"
      ? { prfSalt: bytesToBase64(material.prfSalt) }
      : {}),
  });
}

/**
 * Stop a credential from unlocking the vault and revoke its identity binding.
 */
export async function removeVaultCredential(
  credentialId: string
): Promise<void> {
  await trpc.secrets.removeCredential.mutate({ credentialId });
}

/**
 * Prove a credential opens the vault: unlock the vault key with it and
 * decrypt every other vault secret. Returns the secret types it opened.
 */
export async function verifyVaultCredential(
  material: VaultCredentialMaterial
): Promise<SecretType[]> {
  const vaultKey = await unlockVaultKey(material);
  if (!vaultKey) {
    return [];
  }

  const opened: SecretType[] = [VAULT_ROOT_SECRET_TYPE];
  for (const secretType of Object.values(SECRET_TYPES)) {
    if (secretType === VAULT_ROOT_SECRET_TYPE) {
      continue;
    }
    const result = await openVaultSecret(vaultKey, { secretType });
    if (result) {
      opened.push(secretType);
    }
  }
  return opened;
}
