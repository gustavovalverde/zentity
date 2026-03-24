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
 * - TTL fallback (10 min) as safety net for missed cleanup
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

// --- Recovery Key Cache (raw ML-KEM public key bytes) ---

let cachedRecoveryPublicKey: {
  keyId: string;
  publicKey: Uint8Array;
} | null = null;

export function getCachedRecoveryPublicKey(): {
  keyId: string;
  publicKey: Uint8Array;
} | null {
  return cachedRecoveryPublicKey;
}

export function setCachedRecoveryPublicKey(params: {
  keyId: string;
  publicKey: Uint8Array;
}): void {
  cachedRecoveryPublicKey = params;
}

function clearCachedRecoveryPublicKey(): void {
  cachedRecoveryPublicKey = null;
}

// --- Binding Material Cache ---
// Holds raw credential material from FHE enrollment for identity binding proof.
// Cleared after proof generation; TTL is a safety net only.

const BINDING_MATERIAL_TTL_MS = 10 * 60 * 1000;

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

function wipeBytes(value: Uint8Array): void {
  value.fill(0);
}

function wipeBindingMaterial(material: CachedBindingMaterial | null): void {
  if (!material) {
    return;
  }

  if (material.mode === "passkey") {
    wipeBytes(material.prfOutput);
    wipeBytes(material.prfSalt);
    return;
  }

  if (material.mode === "opaque") {
    wipeBytes(material.exportKey);
    return;
  }

  wipeBytes(material.signatureBytes);
}

export function setCachedBindingMaterial(
  material: CachedBindingMaterial
): void {
  wipeBindingMaterial(bindingMaterial);
  bindingMaterial = material;
  if (bindingMaterialTimer) {
    clearTimeout(bindingMaterialTimer);
  }
  bindingMaterialTimer = setTimeout(
    clearCachedBindingMaterial,
    BINDING_MATERIAL_TTL_MS
  );
}

/**
 * Returns a snapshot with cloned byte arrays so the TTL wipe
 * cannot zero buffers that are still in-flight.
 */
export function getCachedBindingMaterial(): CachedBindingMaterial | null {
  if (!bindingMaterial) {
    return null;
  }

  if (bindingMaterial.mode === "passkey") {
    return {
      mode: "passkey",
      prfOutput: bindingMaterial.prfOutput.slice(),
      credentialId: bindingMaterial.credentialId,
      prfSalt: bindingMaterial.prfSalt.slice(),
    };
  }

  if (bindingMaterial.mode === "opaque") {
    return {
      mode: "opaque",
      exportKey: bindingMaterial.exportKey.slice(),
    };
  }

  return {
    mode: "wallet",
    signatureBytes: bindingMaterial.signatureBytes.slice(),
  };
}

export function clearCachedBindingMaterial(): void {
  wipeBindingMaterial(bindingMaterial);
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
  clearCachedRecoveryPublicKey();
  clearCachedBindingMaterial();
}
