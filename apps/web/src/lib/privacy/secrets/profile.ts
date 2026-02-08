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

/**
 * Store profile secret encrypted with the user's credential.
 * Skips if a profile secret already exists (idempotent).
 */
export async function storeProfileSecret(params: {
  extractedData: {
    extractedFullName?: string | null;
    extractedFirstName?: string | null;
    extractedLastName?: string | null;
    extractedDOB?: string | null;
    extractedBirthYear?: number | null;
    extractedAddress?: string | null;
    extractedAddressCountryCode?: string | null;
    extractedExpirationDate?: number | null;
    extractedDocumentNumber?: string | null;
    extractedDocumentType?: string | null;
    extractedDocumentOrigin?: string | null;
    extractedNationality?: string | null;
    extractedNationalityCode?: string | null;
    documentHash?: string | null;
    userSalt?: string | null;
  };
  credential: EnrollmentCredential;
}): Promise<void> {
  const { storeSecretWithCredential } = await import("./index");

  // Check if profile secret already exists
  const { trpc } = await import("@/lib/trpc/client");
  const bundle = await trpc.secrets.getSecretBundle.query({
    secretType: SECRET_TYPES.PROFILE,
  });
  if (bundle?.secret && bundle.wrappers?.length) {
    return;
  }

  const profile: ProfileSecretPayload = {
    fullName: params.extractedData.extractedFullName ?? null,
    firstName: params.extractedData.extractedFirstName ?? null,
    lastName: params.extractedData.extractedLastName ?? null,
    dateOfBirth: params.extractedData.extractedDOB ?? null,
    birthYear: params.extractedData.extractedBirthYear ?? null,
    residentialAddress: params.extractedData.extractedAddress ?? null,
    addressCountryCode:
      params.extractedData.extractedAddressCountryCode ?? null,
    expiryDateInt: params.extractedData.extractedExpirationDate ?? null,
    documentNumber: params.extractedData.extractedDocumentNumber ?? null,
    documentType: params.extractedData.extractedDocumentType ?? null,
    documentOrigin: params.extractedData.extractedDocumentOrigin ?? null,
    nationality: params.extractedData.extractedNationality ?? null,
    nationalityCode: params.extractedData.extractedNationalityCode ?? null,
    documentHash: params.extractedData.documentHash ?? null,
    userSalt: params.extractedData.userSalt ?? null,
    updatedAt: new Date().toISOString(),
  };

  const plaintext = new TextEncoder().encode(JSON.stringify(profile));

  await storeSecretWithCredential({
    secretType: SECRET_TYPES.PROFILE,
    plaintext,
    credential: params.credential,
    envelopeFormat: PROFILE_ENVELOPE_FORMAT,
  });

  cacheProfile(profile);
}

/**
 * Get stored profile using explicit credential material (wallet or OPAQUE).
 * Unlike `getStoredProfile` which auto-prompts passkey or throws,
 * this accepts credential material directly.
 */
export async function getStoredProfileWithCredential(
  credential:
    | { type: "opaque"; exportKey: Uint8Array }
    | {
        type: "wallet";
        address: string;
        chainId: number;
        signatureBytes: Uint8Array;
      }
): Promise<ProfileSecretPayload | null> {
  const cachedProfile = getCachedProfile();
  if (cachedProfile) {
    return cachedProfile;
  }

  const { loadSecretWithCredential } = await import("./index");
  const result = await loadSecretWithCredential({
    secretType: SECRET_TYPES.PROFILE,
    expectedEnvelopeFormat: PROFILE_ENVELOPE_FORMAT,
    secretLabel: "profile data",
    credential,
  });

  if (!result) {
    return null;
  }

  const profile = deserializeProfile(result.plaintext);
  cacheProfile(profile);
  return profile;
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
