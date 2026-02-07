"use client";

/**
 * Profile Secret Module
 *
 * Handles profile-specific secret loading with caching.
 * Profile data is PII that requires credential unlock.
 */

import type { EnrollmentCredential, EnvelopeFormat } from "./types";

import { SECRET_TYPES } from "./types";

const PROFILE_ENVELOPE_FORMAT: EnvelopeFormat = "json";
const CACHE_TTL_MS = 15 * 60 * 1000;
const GREETING_NAME_KEY = "zentity:greeting";
const WHITESPACE_RE = /\s+/;

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
  persistGreetingName(profile.firstName);
  notifyListeners();
}

function persistGreetingName(firstName: string | null | undefined) {
  try {
    // Store only the first word — minimize PII in unencrypted storage
    const short = firstName?.split(WHITESPACE_RE)[0];
    if (short) {
      sessionStorage.setItem(GREETING_NAME_KEY, short);
    }
  } catch {
    // sessionStorage unavailable (SSR, private browsing quota)
  }
}

/**
 * Read the cached greeting name from sessionStorage.
 * Survives page refreshes without requiring credential unlock.
 */
export function getCachedGreetingName(): string | null {
  try {
    return sessionStorage.getItem(GREETING_NAME_KEY);
  } catch {
    return null;
  }
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

const textEncoder = new TextEncoder();

/**
 * Store profile data as a credential-encrypted secret.
 * Updates the in-memory cache immediately so dashboard can display the name
 * without requiring a separate unlock.
 */
export async function storeProfileSecret(params: {
  payload: ProfileSecretPayload;
  credential: EnrollmentCredential;
}): Promise<{ secretId: string }> {
  const { storeSecretWithCredential } = await import("./index");

  const plaintext = textEncoder.encode(JSON.stringify(params.payload));
  const result = await storeSecretWithCredential({
    secretType: SECRET_TYPES.PROFILE,
    plaintext,
    credential: params.credential,
    envelopeFormat: PROFILE_ENVELOPE_FORMAT,
  });

  cacheProfile(params.payload);
  return { secretId: result.secretId };
}

/**
 * Clear the profile secret cache.
 */
export function resetProfileSecretCache(): void {
  cached = undefined;
  pendingGetStoredProfile = null;
  try {
    sessionStorage.removeItem(GREETING_NAME_KEY);
  } catch {
    // sessionStorage unavailable
  }
  notifyListeners();
}
