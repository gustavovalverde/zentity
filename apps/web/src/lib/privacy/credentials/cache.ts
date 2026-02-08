"use client";

/**
 * Credential Cache Module
 *
 * Caches credential material in memory for the verification session only.
 * Material is cleared immediately after proof generation and has a fallback
 * TTL to prevent leaks if cleanup code doesn't run.
 *
 * Security properties:
 * - JS heap only — never touches localStorage, sessionStorage, or cookies
 * - Tab-scoped — cleared on page refresh or tab close
 * - Explicitly cleared after proof generation (success or failure)
 * - TTL fallback (15 min) as safety net for missed cleanup
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

// --- Binding Material Cache ---
// Holds raw credential material from FHE enrollment for identity binding proof.
// Cleared after proof generation; TTL is a safety net only.

const BINDING_MATERIAL_TTL_MS = 15 * 60 * 1000;

export type CachedBindingMaterial =
  | {
      mode: "passkey";
      prfOutput: Uint8Array;
      credentialId: string;
      prfSalt: Uint8Array;
    }
  | { mode: "opaque"; exportKey: Uint8Array }
  | { mode: "wallet"; signatureBytes: Uint8Array };

let bindingMaterial: CachedBindingMaterial | null = null;
let bindingMaterialTimer: ReturnType<typeof setTimeout> | null = null;

export function setCachedBindingMaterial(
  material: CachedBindingMaterial
): void {
  bindingMaterial = material;
  if (bindingMaterialTimer) {
    clearTimeout(bindingMaterialTimer);
  }
  bindingMaterialTimer = setTimeout(
    clearCachedBindingMaterial,
    BINDING_MATERIAL_TTL_MS
  );
}

export function getCachedBindingMaterial(): CachedBindingMaterial | null {
  return bindingMaterial;
}

export function clearCachedBindingMaterial(): void {
  bindingMaterial = null;
  if (bindingMaterialTimer) {
    clearTimeout(bindingMaterialTimer);
    bindingMaterialTimer = null;
  }
}

// --- Clear All ---

export function clearAllCredentialCaches(): void {
  pendingUnlock = null;
  pendingUnlockKey = null;
  clearCachedRecoveryKey();
  clearCachedBindingMaterial();
}
