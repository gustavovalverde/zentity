"use client";

/**
 * Credential Cache Module
 *
 * Centralized caching for credential-derived key materials.
 * All caches use consistent TTL patterns and clear on logout.
 */
import {
  createTtlCache,
  createValidatedTtlCache,
} from "@/lib/privacy/utils/ttl-cache";

// --- TTL Constants ---

const PASSKEY_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const OPAQUE_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

// --- Passkey Cache ---

interface CachedPasskeyUnlock {
  credentialId: string;
  prfOutput: Uint8Array;
  prfSalt: Uint8Array;
}

const passkeyCache = createTtlCache<CachedPasskeyUnlock>(PASSKEY_CACHE_TTL_MS);

// Pending unlock deduplication
let pendingUnlock: Promise<CachedPasskeyUnlock & { cachedAt: number }> | null =
  null;
let pendingUnlockKey: string | null = null;

export function getCachedPasskeyUnlock(
  allowedCredentialIds: string[]
): CachedPasskeyUnlock | null {
  const cached = passkeyCache.get();
  if (!cached) {
    return null;
  }
  if (!allowedCredentialIds.includes(cached.credentialId)) {
    return null;
  }
  return cached;
}

export function cachePasskeyUnlock(params: {
  credentialId: string;
  prfOutput: Uint8Array;
  prfSalt: Uint8Array;
}): void {
  passkeyCache.set({
    credentialId: params.credentialId,
    prfOutput: params.prfOutput,
    prfSalt: params.prfSalt,
  });
}

export function resetPasskeyUnlockCache(): void {
  passkeyCache.clear();
  pendingUnlock = null;
  pendingUnlockKey = null;
}

export function hasCachedPasskeyUnlock(): boolean {
  return passkeyCache.has();
}

export function getCachedPasskeyPrfOutput(
  allowedCredentialIds: string[]
): Uint8Array | null {
  const cached = getCachedPasskeyUnlock(allowedCredentialIds);
  return cached?.prfOutput ?? null;
}

export function getPendingUnlock(): {
  promise: Promise<CachedPasskeyUnlock & { cachedAt: number }>;
  key: string;
} | null {
  if (pendingUnlock && pendingUnlockKey) {
    return { promise: pendingUnlock, key: pendingUnlockKey };
  }
  return null;
}

export function setPendingUnlock(
  key: string,
  promise: Promise<CachedPasskeyUnlock & { cachedAt: number }>
): void {
  pendingUnlock = promise;
  pendingUnlockKey = key;
}

export function clearPendingUnlock(
  matchPromise?: Promise<CachedPasskeyUnlock & { cachedAt: number }>
): void {
  if (!matchPromise || pendingUnlock === matchPromise) {
    pendingUnlock = null;
    pendingUnlockKey = null;
  }
}

// --- OPAQUE Cache ---

interface CachedOpaqueExport {
  userId: string;
  exportKey: Uint8Array;
}

const opaqueCache = createValidatedTtlCache<CachedOpaqueExport, string>(
  OPAQUE_CACHE_TTL_MS,
  (entry, userId) => entry.userId === userId
);

export function getCachedOpaqueExportKey(userId: string): Uint8Array | null {
  const cached = opaqueCache.get(userId);
  return cached?.exportKey ?? null;
}

export function cacheOpaqueExportKey(params: {
  userId: string;
  exportKey: Uint8Array;
}): void {
  opaqueCache.set({
    userId: params.userId,
    exportKey: params.exportKey,
  });
}

export function resetOpaqueExportCache(): void {
  opaqueCache.clear();
}

export function isOpaqueCacheFresh(userId: string): boolean {
  return opaqueCache.has(userId);
}

export function hasAnyCachedOpaqueExport(): boolean {
  return opaqueCache.getRaw() !== null;
}

export function getCachedOpaqueUserId(): string | null {
  return opaqueCache.getRaw()?.value.userId ?? null;
}

// --- Recovery Key Cache (no TTL, cleared on logout) ---

let cachedRecoveryKey: { keyId: string; cryptoKey: CryptoKey } | null = null;

export function getCachedRecoveryKey(): {
  keyId: string;
  cryptoKey: CryptoKey;
} | null {
  return cachedRecoveryKey;
}

export function setCachedRecoveryKey(params: {
  keyId: string;
  cryptoKey: CryptoKey;
}): void {
  cachedRecoveryKey = params;
}

function clearCachedRecoveryKey(): void {
  cachedRecoveryKey = null;
}

// --- Aggregate Check ---

// Wallet cache lives in wallet.ts to avoid circular deps (wallet → derivation).
// wallet.ts registers its check here on module load.
let walletCacheCheck: (() => boolean) | null = null;

export function registerWalletCacheCheck(fn: () => boolean): void {
  walletCacheCheck = fn;
}

/**
 * Check if ANY credential material is cached (passkey, OPAQUE, or wallet).
 * Used to gate auto-unlock of profile vault without prompting the user.
 */
export function hasAnyCachedCredential(): boolean {
  if (passkeyCache.has()) {
    return true;
  }
  if (opaqueCache.getRaw() !== null) {
    return true;
  }
  if (walletCacheCheck?.()) {
    return true;
  }
  return false;
}

// --- Clear All Caches ---

/**
 * Clears all credential caches including passkey, OPAQUE, recovery, and wallet.
 *
 * Note: Wallet cache is imported dynamically to avoid circular dependencies
 * since wallet.ts depends on derivation.ts which may have indirect dependencies.
 */
export function clearAllCredentialCaches(): void {
  resetPasskeyUnlockCache();
  resetOpaqueExportCache();
  clearCachedRecoveryKey();
  // Wallet cache is reset via the wallet module's resetWalletSignatureCache
  // Called separately by callers that need to clear wallet cache
}
