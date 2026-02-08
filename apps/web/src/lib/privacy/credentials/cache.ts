"use client";

/**
 * Credential Cache Module
 *
 * Minimal cache for non-secret metadata only.
 * Raw credential material (PRF output, OPAQUE export key, wallet signatures)
 * is NEVER cached — each operation prompts for fresh material.
 */

// --- Pending Passkey Unlock Deduplication ---
// Prevents duplicate concurrent WebAuthn prompts (NOT a time-based cache).

interface PendingUnlockResult {
  credentialId: string;
  prfOutput: Uint8Array;
}

let pendingUnlock: Promise<PendingUnlockResult> | null = null;
let pendingUnlockKey: string | null = null;

export function getPendingUnlock(): {
  promise: Promise<PendingUnlockResult>;
  key: string;
} | null {
  if (pendingUnlock && pendingUnlockKey) {
    return { promise: pendingUnlock, key: pendingUnlockKey };
  }
  return null;
}

export function setPendingUnlock(
  key: string,
  promise: Promise<PendingUnlockResult>
): void {
  pendingUnlock = promise;
  pendingUnlockKey = key;
}

export function clearPendingUnlock(
  matchPromise?: Promise<PendingUnlockResult>
): void {
  if (!matchPromise || pendingUnlock === matchPromise) {
    pendingUnlock = null;
    pendingUnlockKey = null;
  }
}

// --- Recovery Key Cache (CryptoKey, not credential material) ---

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

// --- Clear All ---

export function clearAllCredentialCaches(): void {
  pendingUnlock = null;
  pendingUnlockKey = null;
  clearCachedRecoveryKey();
}
