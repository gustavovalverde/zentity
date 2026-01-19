"use client";

import type { EnvelopeFormat } from "./passkey-vault";

import { SECRET_TYPES } from "./secret-types";
import { loadSecret } from "./secret-vault";

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
 * Call this during sign-out and before sign-in to ensure clean state
 * when users switch on shared browsers.
 */
export function resetProfileSecretCache(): void {
  cached = undefined;
  pendingGetStoredProfile = null;
  notifyListeners();
}
