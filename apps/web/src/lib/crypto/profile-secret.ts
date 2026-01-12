"use client";

import type { EnvelopeFormat } from "./passkey-vault";
import type {
  EnrollmentCredential,
  PasskeyEnrollmentContext,
} from "./secret-vault";

import {
  loadSecret,
  storeSecret,
  storeSecretWithCredential,
} from "./secret-vault";

export const PROFILE_SECRET_TYPE = "profile_v1";
const PROFILE_ENVELOPE_FORMAT: EnvelopeFormat = "json";
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

export async function storeProfileSecret(params: {
  profile: ProfileSecretPayload;
  enrollment: PasskeyEnrollmentContext;
}): Promise<{ secretId: string }> {
  const secretPayload = serializeProfile(params.profile);
  const result = await storeSecret({
    secretType: PROFILE_SECRET_TYPE,
    plaintext: secretPayload,
    enrollment: params.enrollment,
    envelopeFormat: PROFILE_ENVELOPE_FORMAT,
  });

  cacheProfile(result.secretId, params.profile);

  return { secretId: result.secretId };
}

/**
 * Store profile secret with support for both passkey and OPAQUE credential types.
 * This is the recommended function for new code during onboarding.
 */
export async function storeProfileSecretWithCredential(params: {
  profile: ProfileSecretPayload;
  credential: EnrollmentCredential;
}): Promise<{ secretId: string }> {
  const secretPayload = serializeProfile(params.profile);
  const result = await storeSecretWithCredential({
    secretType: PROFILE_SECRET_TYPE,
    plaintext: secretPayload,
    credential: params.credential,
    envelopeFormat: PROFILE_ENVELOPE_FORMAT,
  });

  cacheProfile(result.secretId, params.profile);

  return { secretId: result.secretId };
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

    const result = await loadSecret({
      secretType: PROFILE_SECRET_TYPE,
      expectedEnvelopeFormat: PROFILE_ENVELOPE_FORMAT,
      secretLabel: "profile data",
    });

    if (!result) {
      return null;
    }

    const profile = deserializeProfile(result.plaintext);
    cacheProfile(result.secretId, profile);
    return profile;
  };

  pendingGetStoredProfile = doGetStoredProfile().finally(() => {
    pendingGetStoredProfile = null;
  });

  return pendingGetStoredProfile;
}

/**
 * Clear the profile secret cache.
 * Call this during sign-out and before sign-in to ensure clean state
 * when users switch on shared browsers.
 */
export function resetProfileSecretCache(): void {
  cached = undefined;
  pendingGetStoredProfile = null;
  notifyListeners();
}
