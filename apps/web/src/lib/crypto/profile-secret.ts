"use client";

import type { PasskeyEnrollmentContext } from "./fhe-key-store";

import { trpc } from "@/lib/trpc/client";
import { base64ToBytes, bytesToBase64 } from "@/lib/utils/base64";

import {
  createSecretEnvelope,
  decryptSecretEnvelope,
  PASSKEY_VAULT_VERSION,
  WRAP_VERSION,
} from "./passkey-vault";
import { downloadSecretBlob, uploadSecretBlob } from "./secret-blob-client";
import { evaluatePrf } from "./webauthn-prf";

export const PROFILE_SECRET_TYPE = "profile_v1";
const CACHE_TTL_MS = 15 * 60 * 1000;

export interface ProfileSecretPayload {
  fullName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  dateOfBirth?: string | null;
  birthYear?: number | null;
  expiryDateInt?: number | null;
  documentNumber?: string | null;
  documentType?: string | null;
  documentOrigin?: string | null;
  nationality?: string | null;
  nationalityCode?: string | null;
  documentHash?: string | null;
  userSalt?: string | null;
  updatedAt: string;
}

let cached:
  | {
      profile: ProfileSecretPayload;
      secretId: string;
      cachedAt: number;
    }
  | undefined;

// Promise deduplication to prevent concurrent passkey prompts
let pendingGetStoredProfile: Promise<ProfileSecretPayload | null> | null = null;

// Subscription pattern for useSyncExternalStore
type ProfileListener = () => void;
const listeners = new Set<ProfileListener>();

function notifyListeners() {
  for (const listener of listeners) {
    listener();
  }
}

/**
 * Subscribe to profile cache changes for useSyncExternalStore.
 * Returns an unsubscribe function.
 */
export function subscribeToProfileCache(listener: ProfileListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Get the current cached profile snapshot for useSyncExternalStore.
 * Returns null if no valid cache exists.
 */
export function getProfileSnapshot(): ProfileSecretPayload | null {
  return getCachedProfile();
}

/**
 * Server-side snapshot for useSyncExternalStore.
 * Always returns null since profile requires passkey auth.
 */
export function getServerProfileSnapshot(): ProfileSecretPayload | null {
  return null;
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function serializeProfile(profile: ProfileSecretPayload): Uint8Array {
  return textEncoder.encode(JSON.stringify(profile));
}

function deserializeProfile(payload: Uint8Array): ProfileSecretPayload {
  const parsed = JSON.parse(
    textDecoder.decode(payload)
  ) as ProfileSecretPayload;
  return {
    ...parsed,
    updatedAt: parsed.updatedAt || new Date().toISOString(),
  };
}

function getCachedProfile(): ProfileSecretPayload | null {
  if (!cached) {
    return null;
  }
  if (Date.now() - cached.cachedAt > CACHE_TTL_MS) {
    cached = undefined;
    return null;
  }
  return cached.profile;
}

function cacheProfile(secretId: string, profile: ProfileSecretPayload) {
  cached = { profile, secretId, cachedAt: Date.now() };
  notifyListeners();
}

export async function createProfileEnvelope(params: {
  profile: ProfileSecretPayload;
  enrollment: PasskeyEnrollmentContext;
}): Promise<{
  secretId: string;
  encryptedBlob: string;
  wrappedDek: string;
  prfSalt: string;
}> {
  const secretPayload = serializeProfile(params.profile);
  return await createSecretEnvelope({
    secretType: PROFILE_SECRET_TYPE,
    plaintext: secretPayload,
    prfOutput: params.enrollment.prfOutput,
    credentialId: params.enrollment.credentialId,
    prfSalt: params.enrollment.prfSalt,
  });
}

export async function storeProfileSecret(params: {
  profile: ProfileSecretPayload;
  enrollment: PasskeyEnrollmentContext;
}): Promise<{ secretId: string }> {
  const envelope = await createProfileEnvelope(params);

  const blobMetadata = await uploadSecretBlob({
    secretId: envelope.secretId,
    secretType: PROFILE_SECRET_TYPE,
    payload: textEncoder.encode(envelope.encryptedBlob),
  });

  await trpc.secrets.storeSecret.mutate({
    secretId: envelope.secretId,
    secretType: PROFILE_SECRET_TYPE,
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

  cacheProfile(envelope.secretId, params.profile);

  return { secretId: envelope.secretId };
}

export function getStoredProfile(): Promise<ProfileSecretPayload | null> {
  const cachedProfile = getCachedProfile();
  if (cachedProfile) {
    return Promise.resolve(cachedProfile);
  }

  // Deduplicate concurrent calls to prevent multiple passkey prompts
  if (pendingGetStoredProfile) {
    return pendingGetStoredProfile;
  }

  const doGetStoredProfile = async (): Promise<ProfileSecretPayload | null> => {
    // Re-check cache in case it was populated while waiting
    const recheck = getCachedProfile();
    if (recheck) {
      return recheck;
    }

    const bundle = await trpc.secrets.getSecretBundle.query({
      secretType: PROFILE_SECRET_TYPE,
    });

    if (!bundle?.secret) {
      return null;
    }

    if (bundle.secret.version !== PASSKEY_VAULT_VERSION) {
      throw new Error(
        "Unsupported secret version. Please re-secure your profile data."
      );
    }

    if (!bundle.wrappers?.length) {
      throw new Error("No passkeys are registered for this profile secret.");
    }

    if (!bundle.secret.blobRef) {
      throw new Error("Encrypted profile blob is missing.");
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
      secretType: PROFILE_SECRET_TYPE,
      encryptedBlob,
      wrappedDek: selectedWrapper.wrappedDek,
      credentialId: selectedWrapper.credentialId,
      prfOutput,
    });

    const profile = deserializeProfile(plaintext);
    cacheProfile(bundle.secret.id, profile);
    return profile;
  };

  pendingGetStoredProfile = doGetStoredProfile().finally(() => {
    pendingGetStoredProfile = null;
  });

  return pendingGetStoredProfile;
}
