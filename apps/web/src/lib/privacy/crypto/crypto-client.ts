/**
 * Crypto Client Library
 *
 * Client-side ZK proof generation using Noir.js and Barretenberg.
 * Proofs are generated in the browser - sensitive data never leaves the device.
 */

"use client";

import type {
  AgeProofFull,
  AgeProofSummary,
} from "@/lib/privacy/crypto/age-proof-types";
import type { StoredFheKeys } from "@/lib/privacy/crypto/fhe-key-store";
import type { EnvelopeFormat } from "@/lib/privacy/crypto/passkey-vault";
import type { PasskeyEnrollmentContext } from "@/lib/privacy/crypto/secret-vault";
import type { RouterOutputs } from "@/lib/trpc/types";

import {
  dobToDaysSince1900,
  getTodayDobDays,
  minAgeYearsToDays,
} from "@/lib/identity/verification/birth-year";
import { recordClientMetric } from "@/lib/observability/client-metrics";
import { fetchMsgpack } from "@/lib/privacy/crypto/binary-transport";
import { createFheKeyEnvelope } from "@/lib/privacy/crypto/fhe-key-store";
import {
  decryptFheBool,
  generateFheKeyMaterialForStorage as generateFheKeyMaterialForStorageImpl,
  getOrCreateFheKeyRegistrationMaterial,
  persistFheKeyId,
} from "@/lib/privacy/crypto/tfhe-browser";
import {
  generateAgeProofNoir,
  generateDocValidityProofNoir,
  generateFaceMatchProofNoir,
  generateNationalityProofNoir,
} from "@/lib/privacy/zk/noir-prover";
import { trpc } from "@/lib/trpc/client";
import { bytesToBase64 } from "@/lib/utils/base64";

// Re-export for use in password sign-up flow
export const generateFheKeyMaterialForStorage =
  generateFheKeyMaterialForStorageImpl;

type CryptoOutputs = RouterOutputs["crypto"];

// Types for ZK proof operations
interface ProofResult {
  proof: string; // Base64 encoded UltraHonk ZK proof
  publicSignals: string[];
  generationTimeMs: number;
}

type ClientProofType =
  | "age_verification"
  | "doc_validity"
  | "face_match"
  | "nationality_membership";

function recordProofSuccess(
  proofType: ClientProofType,
  result: { proof: Uint8Array; generationTimeMs: number }
): void {
  recordClientMetric({
    name: "client.noir.proof.duration",
    value: result.generationTimeMs,
    attributes: { proof_type: proofType, result: "ok" },
  });
  recordClientMetric({
    name: "client.noir.proof.bytes",
    value: result.proof.byteLength,
    attributes: { proof_type: proofType },
  });
}

function recordProofError(proofType: ClientProofType, startTime: number): void {
  recordClientMetric({
    name: "client.noir.proof.duration",
    value: performance.now() - startTime,
    attributes: { proof_type: proofType, result: "error" },
  });
}

// Types for FHE operations
interface VerifyAgeFHEResult {
  isOver18: boolean;
  computationTimeMs: number;
}

type ServiceHealth = CryptoOutputs["health"];

interface ChallengeResponse {
  nonce: string;
  circuitType: string;
  expiresAt: string;
}

/**
 * In-flight request tracking with automatic TTL cleanup.
 * These maps are naturally bounded by their key space but we add TTL
 * as a defensive measure against edge cases where cleanup doesn't run.
 */
const CHALLENGE_TTL_MS = 60_000; // 1 minute
const REGISTRATION_TTL_MS = 120_000; // 2 minutes

interface TimestampedEntry<T> {
  promise: T;
  createdAt: number;
}

const challengeInFlight = new Map<
  ClientProofType,
  TimestampedEntry<Promise<ChallengeResponse>>
>();
const registerFheKeyInFlight = new Map<
  string,
  TimestampedEntry<Promise<{ keyId: string }>>
>();

/**
 * Cleanup stale entries from in-flight maps.
 * Called periodically and before adding new entries.
 */
function cleanupStaleEntries(): void {
  const now = Date.now();

  for (const [key, entry] of challengeInFlight) {
    if (now - entry.createdAt > CHALLENGE_TTL_MS) {
      challengeInFlight.delete(key);
    }
  }

  for (const [key, entry] of registerFheKeyInFlight) {
    if (now - entry.createdAt > REGISTRATION_TTL_MS) {
      registerFheKeyInFlight.delete(key);
    }
  }
}

/**
 * Generate a zero-knowledge proof of age (CLIENT-SIDE)
 *
 * The proof is generated entirely in the browser using a Web Worker.
 * DOB NEVER leaves the device - only the cryptographic proof is returned.
 *
 * @param dateOfBirth - User DOB string (will NOT be stored or sent anywhere)
 * @param minAgeYears - Minimum age to prove (years)
 */
export async function generateAgeProof(
  dateOfBirth: string,
  minAgeYears: number,
  options: {
    /** Server-issued nonce to bind the proof to a challenge. */
    nonce: string;
    /** Poseidon field element for document hash commitment. */
    documentHashField: string;
    /** Poseidon claim hash from signed OCR claim. */
    claimHash: string;
  }
): Promise<ProofResult> {
  const nonce = options.nonce;
  const startTime = performance.now();

  try {
    const dobDays = dobToDaysSince1900(dateOfBirth);
    if (dobDays === undefined) {
      throw new Error("Invalid date of birth for age proof");
    }
    const currentDays = getTodayDobDays();
    const minAgeDays = minAgeYearsToDays(minAgeYears);

    const result = await generateAgeProofNoir({
      dobDays,
      currentDays,
      minAgeDays,
      nonce,
      documentHashField: options.documentHashField,
      claimHash: options.claimHash,
    });
    recordProofSuccess("age_verification", result);

    return {
      proof: bytesToBase64(result.proof),
      publicSignals: result.publicInputs,
      generationTimeMs: result.generationTimeMs,
    };
  } catch (error) {
    recordProofError("age_verification", startTime);
    throw error;
  }
}

/**
 * Generate a zero-knowledge proof of nationality membership (CLIENT-SIDE)
 *
 * PRIVACY: Nationality NEVER leaves the browser. The Merkle path is computed
 * in the Web Worker and the proof is generated entirely client-side.
 *
 * @param nationalityCode - ISO alpha-3 code (e.g., "DEU" for Germany)
 * @param groupName - Group to prove membership (e.g., "EU", "SCHENGEN", "EEA", "LATAM", "FIVE_EYES")
 */
interface GenerateNationalityProofOptions {
  nationalityCode: string;
  groupName: string;
  nonce: string;
  documentHashField: string;
  claimHash: string;
}

async function _generateNationalityProof(
  options: GenerateNationalityProofOptions
): Promise<ProofResult> {
  const { nationalityCode, groupName, nonce, documentHashField, claimHash } =
    options;
  const startTime = performance.now();

  try {
    const result = await generateNationalityProofNoir({
      nationalityCode,
      groupName,
      nonce,
      documentHashField,
      claimHash,
    });
    recordProofSuccess("nationality_membership", result);

    return {
      proof: bytesToBase64(result.proof),
      publicSignals: result.publicInputs,
      generationTimeMs: result.generationTimeMs,
    };
  } catch (error) {
    recordProofError("nationality_membership", startTime);
    throw error;
  }
}

export function generateNationalityProof(
  nationalityCode: string,
  groupName: string,
  options: { nonce: string; documentHashField: string; claimHash: string }
): Promise<ProofResult> {
  return _generateNationalityProof({
    nationalityCode,
    groupName,
    nonce: options.nonce,
    documentHashField: options.documentHashField,
    claimHash: options.claimHash,
  });
}

/**
 * Converts current date to YYYYMMDD integer format.
 * Used for date comparisons in ZK circuits.
 */
function _getTodayAsIntClient(): number {
  const today = new Date();
  return (
    today.getFullYear() * 10_000 +
    (today.getMonth() + 1) * 100 +
    today.getDate()
  );
}

/**
 * Generate a ZK proof that a document is not expired (CLIENT-SIDE)
 *
 * @param expiryDate - Document expiry date as YYYYMMDD integer
 * @param currentDate - Current date as YYYYMMDD integer (defaults to today)
 */
export async function generateDocValidityProof(
  expiryDate: number,
  currentDate: number,
  options: { nonce: string; documentHashField: string; claimHash: string }
): Promise<ProofResult> {
  const nonce = options.nonce;
  const startTime = performance.now();

  try {
    const result = await generateDocValidityProofNoir({
      expiryDate,
      currentDate,
      nonce,
      documentHashField: options.documentHashField,
      claimHash: options.claimHash,
    });
    recordProofSuccess("doc_validity", result);

    return {
      proof: bytesToBase64(result.proof),
      publicSignals: result.publicInputs,
      generationTimeMs: result.generationTimeMs,
    };
  } catch (error) {
    recordProofError("doc_validity", startTime);
    throw error;
  }
}

/**
 * Generate a ZK proof that face similarity exceeds threshold (CLIENT-SIDE)
 *
 * PRIVACY: The actual similarity score is not revealed - only that it
 * meets or exceeds the threshold.
 *
 * @param similarityScore - Face match similarity (0-10000 fixed-point, e.g., 7500 = 75%)
 * @param threshold - Minimum similarity required (0-10000 fixed-point)
 */
export async function generateFaceMatchProof(
  similarityScore: number,
  threshold: number,
  options: { nonce: string; documentHashField: string; claimHash: string }
): Promise<ProofResult> {
  const nonce = options.nonce;
  const startTime = performance.now();

  try {
    const result = await generateFaceMatchProofNoir({
      similarityScore,
      threshold,
      nonce,
      documentHashField: options.documentHashField,
      claimHash: options.claimHash,
    });
    recordProofSuccess("face_match", result);

    return {
      proof: bytesToBase64(result.proof),
      publicSignals: result.publicInputs,
      generationTimeMs: result.generationTimeMs,
    };
  } catch (error) {
    recordProofError("face_match", startTime);
    throw error;
  }
}

/**
 * Check health of crypto services
 */
async function _checkCryptoHealth(): Promise<ServiceHealth> {
  return await trpc.crypto.health.query();
}

export async function getSignedClaims(
  documentId?: string | null
): Promise<CryptoOutputs["getSignedClaims"]> {
  return documentId
    ? await trpc.crypto.getSignedClaims.query({ documentId })
    : await trpc.crypto.getSignedClaims.query();
}

/**
 * Get a server-issued challenge nonce for replay-resistant proof generation.
 * The nonce must be included as a public input in the proof.
 *
 * NOTE: This requires authentication.
 * For persisted proofs, always use a server-issued nonce.
 *
 * @param circuitType - The type of circuit the nonce is for
 */
export async function getProofChallenge(
  circuitType: ClientProofType
): Promise<ChallengeResponse> {
  // Cleanup stale entries before checking
  cleanupStaleEntries();

  const inFlight = challengeInFlight.get(circuitType);
  if (inFlight) {
    return await inFlight.promise;
  }
  try {
    const promise = trpc.crypto.createChallenge.mutate({ circuitType });
    challengeInFlight.set(circuitType, { promise, createdAt: Date.now() });
    const response = await promise;
    return response;
  } catch (error) {
    throw new Error(
      error instanceof Error ? error.message : "Failed to get challenge"
    );
  } finally {
    challengeInFlight.delete(circuitType);
  }
}

/**
 * Store user's age proof after verification
 *
 * NOTE: isOver18 is intentionally NOT a parameter.
 * The server extracts this from publicSignals[3] after cryptographic verification.
 * (Index: [0]=current_year, [1]=min_age, [2]=nonce, [3]=is_old_enough)
 * This prevents malicious clients from claiming isOver18=true with invalid proofs.
 *
 * IMPORTANT: Persisted proofs must include a server-issued nonce from getProofChallenge().
 * Client-generated nonces are rejected by the storage endpoint.
 */
interface StoreProofOptions {
  /** The type of circuit used to generate the proof */
  circuitType: ClientProofType;
  /** Base64 encoded UltraHonk ZK proof */
  proof: string;
  /** The public signals from the proof */
  publicSignals: string[];
  /** Time to generate the ZK proof */
  generationTimeMs: number;
  /** Optional document ID to bind proof storage to a specific document */
  documentId?: string | null;
}

export async function storeProof(options: StoreProofOptions): Promise<{
  success: boolean;
  proofId: string;
  proofHash: string;
  verificationTimeMs: number;
}> {
  const { circuitType, proof, publicSignals, generationTimeMs, documentId } =
    options;
  try {
    return await trpc.crypto.storeProof.mutate({
      circuitType,
      proof,
      publicSignals,
      generationTimeMs,
      ...(documentId ? { documentId } : {}),
    });
  } catch (error) {
    throw new Error(
      error instanceof Error ? error.message : "Failed to store proof"
    );
  }
}

/**
 * Get user's stored age proof
 * @param full - If true, returns full proof details including ciphertext metadata
 */
export async function getUserProof(full: true): Promise<AgeProofFull | null>;
export async function getUserProof(
  full?: false
): Promise<AgeProofSummary | null>;
export async function getUserProof(
  full = false
): Promise<AgeProofFull | AgeProofSummary | null> {
  try {
    return await trpc.crypto.getUserProof.query({ full });
  } catch (error) {
    throw new Error(
      error instanceof Error ? error.message : "Failed to get proof"
    );
  }
}

// ============================================================================
// FHE (Fully Homomorphic Encryption) Functions
// ============================================================================

export async function ensureFheKeyRegistration(params?: {
  enrollment?: PasskeyEnrollmentContext;
  registrationToken?: string;
}): Promise<{
  keyId: string;
}> {
  // Cleanup stale entries before checking
  cleanupStaleEntries();

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
 * @param ciphertext - The encrypted birth year offset ciphertext
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
