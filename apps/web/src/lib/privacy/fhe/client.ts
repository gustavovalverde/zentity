/**
 * FHE Client
 *
 * Client-side FHE key enrollment and homomorphic computation operations.
 */

"use client";

import type { StoredFheKeys } from "@/lib/privacy/fhe/store";
import type {
  EnvelopeFormat,
  PasskeyEnrollmentContext,
} from "@/lib/privacy/secrets/types";

import { fetchMsgpack } from "@/lib/privacy/utils/binary-transport";

import {
  decryptFheBool,
  generateFheKeyMaterialForStorage as generateFheKeyMaterialForStorageImpl,
  getOrCreateFheKeyRegistrationMaterial,
  persistFheKeyId,
} from "./browser";
import { createFheKeyEnvelope } from "./store";

// Re-export for use in password sign-up flow
export const generateFheKeyMaterialForStorage =
  generateFheKeyMaterialForStorageImpl;

// Types for FHE operations
interface VerifyAgeFHEResult {
  isOver18: boolean;
  computationTimeMs: number;
}

/**
 * In-flight FHE key registration tracking with TTL cleanup.
 */
const REGISTRATION_TTL_MS = 120_000; // 2 minutes

interface TimestampedEntry<T> {
  promise: T;
  createdAt: number;
}

const registerFheKeyInFlight = new Map<
  string,
  TimestampedEntry<Promise<{ keyId: string }>>
>();

function cleanupStaleRegistrations(): void {
  const now = Date.now();
  for (const [key, entry] of registerFheKeyInFlight) {
    if (now - entry.createdAt > REGISTRATION_TTL_MS) {
      registerFheKeyInFlight.delete(key);
    }
  }
}

export async function ensureFheKeyRegistration(params?: {
  enrollment?: PasskeyEnrollmentContext;
  registrationToken?: string;
}): Promise<{
  keyId: string;
}> {
  cleanupStaleRegistrations();

  const inFlightKey = params?.enrollment?.credentialId ?? "default";
  const inFlight = registerFheKeyInFlight.get(inFlightKey);
  if (inFlight) {
    return await inFlight.promise;
  }

  let resolvePromise: ((value: { keyId: string }) => void) | undefined;
  let rejectPromise: ((reason?: unknown) => void) | undefined;
  const registrationPromise = new Promise<{ keyId: string }>(
    (resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    }
  );

  registerFheKeyInFlight.set(inFlightKey, {
    promise: registrationPromise,
    createdAt: Date.now(),
  });

  const runRegistration = async () => {
    try {
      const keyMaterial = await getOrCreateFheKeyRegistrationMaterial({
        enrollment: params?.enrollment,
      });
      if (keyMaterial.keyId) {
        resolvePromise?.({ keyId: keyMaterial.keyId });
        return;
      }
      const response = await fetchMsgpack<{ keyId: string }>(
        "/api/fhe/keys/register",
        {
          serverKey: keyMaterial.serverKeyBytes,
          publicKey: keyMaterial.publicKeyBytes,
          ...(params?.registrationToken
            ? { registrationToken: params.registrationToken }
            : {}),
        },
        { credentials: "include" }
      );
      await persistFheKeyId(response.keyId);
      resolvePromise?.({ keyId: response.keyId });
    } catch (error) {
      rejectPromise?.(error);
    } finally {
      registerFheKeyInFlight.delete(inFlightKey);
    }
  };

  runRegistration().catch(() => {
    // Errors are surfaced via registrationPromise.
  });

  return await registrationPromise;
}

export async function prepareFheKeyEnrollment(params: {
  enrollment: PasskeyEnrollmentContext;
  onStage?: (stage: "generate-keys" | "encrypt-keys") => void;
}): Promise<{
  secretId: string;
  encryptedBlob: Uint8Array;
  wrappedDek: string;
  prfSalt: string;
  envelopeFormat: EnvelopeFormat;
  publicKeyBytes: Uint8Array;
  serverKeyBytes: Uint8Array;
  storedKeys: StoredFheKeys;
}> {
  params.onStage?.("generate-keys");
  const { storedKeys } = await generateFheKeyMaterialForStorage();
  params.onStage?.("encrypt-keys");
  const envelope = await createFheKeyEnvelope({
    keys: storedKeys,
    enrollment: params.enrollment,
  });

  return {
    ...envelope,
    publicKeyBytes: storedKeys.publicKey,
    serverKeyBytes: storedKeys.serverKey,
    storedKeys,
  };
}

export async function registerFheKeyForEnrollment(params: {
  registrationToken: string;
  publicKeyBytes: Uint8Array;
  serverKeyBytes: Uint8Array;
}): Promise<{ keyId: string }> {
  return await fetchMsgpack<{ keyId: string }>(
    "/api/fhe/keys/register",
    {
      registrationToken: params.registrationToken,
      publicKey: params.publicKeyBytes,
      serverKey: params.serverKeyBytes,
    },
    { credentials: "include" }
  );
}

/**
 * Verify age using FHE (homomorphic computation on encrypted birth year offset)
 * This performs a live computation on the encrypted data without decrypting it
 * @param keyId - Server key identifier registered for this ciphertext
 * @param currentYear - The current year (defaults to current year)
 * @param minAge - Minimum age to check (defaults to 18)
 */
export async function verifyAgeViaFHE(
  keyId: string,
  currentYear: number = new Date().getFullYear(),
  minAge = 18
): Promise<VerifyAgeFHEResult> {
  try {
    const start = Date.now();
    const result = await fetchMsgpack<{
      resultCiphertext: Uint8Array;
      computationTimeMs?: number;
    }>(
      "/api/fhe/verify-age",
      {
        keyId,
        currentYear,
        minAge,
      },
      { credentials: "include" }
    );
    const isOver18 = await decryptFheBool(result.resultCiphertext);
    return {
      isOver18,
      computationTimeMs: Date.now() - start,
    };
  } catch (error) {
    throw new Error(
      error instanceof Error ? error.message : "Failed to verify age via FHE"
    );
  }
}
