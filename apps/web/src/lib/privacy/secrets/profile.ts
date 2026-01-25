"use client";

/**
 * Profile Secret Module
 *
 * Handles profile-specific secret loading with caching.
 * Profile data is PII that requires credential unlock.
 */

import { type EnvelopeFormat, SECRET_TYPES } from "./types";

const PROFILE_ENVELOPE_FORMAT: EnvelopeFormat = "json";
const CACHE_TTL_MS = 15 * 60 * 1000;

export interface ProfileSecretPayload {
  fullName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  dateOfBirth?: string | null;
  birthYear?: number | null;
  residentialAddress?: string | null;
  addressCountryCode?: string | null;
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

let pendingGetStoredProfile: Promise<ProfileSecretPayload | null> | null = null;

type ProfileListener = () => void;
const listeners = new Set<ProfileListener>();

function notifyListeners() {
  for (const listener of listeners) {
    listener();
  }
}

/**
 * Subscribe to profile cache changes for useSyncExternalStore.
 */
export function subscribeToProfileCache(listener: ProfileListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Get the current cached profile snapshot for useSyncExternalStore.
 */
export function getProfileSnapshot(): ProfileSecretPayload | null {
  return getCachedProfile();
}

/**
 * Server-side snapshot for useSyncExternalStore.
 */
export function getServerProfileSnapshot(): ProfileSecretPayload | null {
  return null;
}

const textDecoder = new TextDecoder();

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

function cacheProfile(profile: ProfileSecretPayload) {
  cached = { profile, secretId: "cached", cachedAt: Date.now() };
  notifyListeners();
}

/**
 * Get the stored profile, loading from secrets if not cached.
 * Uses promise deduplication to prevent concurrent passkey prompts.
 */
export function getStoredProfile(): Promise<ProfileSecretPayload | null> {
  const cachedProfile = getCachedProfile();
  if (cachedProfile) {
    return Promise.resolve(cachedProfile);
  }

  if (pendingGetStoredProfile) {
    return pendingGetStoredProfile;
  }

  const doGetStoredProfile = async (): Promise<ProfileSecretPayload | null> => {
    // Re-check cache in case it was populated while waiting
    const recheck = getCachedProfile();
    if (recheck) {
      return recheck;
    }

    // Dynamic import to avoid circular dependency
    const { loadSecret } = await import("./index");
    const result = await loadSecret({
      secretType: SECRET_TYPES.PROFILE,
      expectedEnvelopeFormat: PROFILE_ENVELOPE_FORMAT,
      secretLabel: "profile data",
    });

    if (!result) {
      return null;
    }

    const profile = deserializeProfile(result.plaintext);
    cacheProfile(profile);
    return profile;
  };

  pendingGetStoredProfile = doGetStoredProfile().finally(() => {
    pendingGetStoredProfile = null;
  });

  return pendingGetStoredProfile;
}

/**
 * Clear the profile secret cache.
 */
export function resetProfileSecretCache(): void {
  cached = undefined;
  pendingGetStoredProfile = null;
  notifyListeners();
}
