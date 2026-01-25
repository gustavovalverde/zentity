/**
 * ZK Client
 *
 * Client-side ZK proof generation using Noir.js and Barretenberg.
 * Proofs are generated in the browser - sensitive data never leaves the device.
 */

"use client";

import type {
  AgeProofFull,
  AgeProofSummary,
} from "@/lib/privacy/zk/age-proof-types";
import type { RouterOutputs } from "@/lib/trpc/types";

import {
  dobToDaysSince1900,
  getTodayDobDays,
  minAgeYearsToDays,
} from "@/lib/identity/verification/birth-year";
import { recordClientMetric } from "@/lib/observability/client-metrics";
import { trpc } from "@/lib/trpc/client";
import { bytesToBase64 } from "@/lib/utils/base64";

import {
  generateAgeProofNoir,
  generateDocValidityProofNoir,
  generateFaceMatchProofNoir,
  generateIdentityBindingProofNoir,
  generateNationalityProofNoir,
} from "./noir-prover";

type CryptoOutputs = RouterOutputs["crypto"];

// Types for ZK proof operations
export interface ProofResult {
  proof: string; // Base64 encoded UltraHonk ZK proof
  publicSignals: string[];
  generationTimeMs: number;
}

export type ClientProofType =
  | "age_verification"
  | "doc_validity"
  | "face_match"
  | "nationality_membership"
  | "identity_binding";

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

interface ChallengeResponse {
  nonce: string;
  circuitType: string;
  expiresAt: string;
}

/**
 * In-flight challenge request tracking with TTL cleanup.
 */
const CHALLENGE_TTL_MS = 60_000; // 1 minute

interface TimestampedEntry<T> {
  promise: T;
  createdAt: number;
}

const challengeInFlight = new Map<
  ClientProofType,
  TimestampedEntry<Promise<ChallengeResponse>>
>();

function cleanupStaleChallenges(): void {
  const now = Date.now();
  for (const [key, entry] of challengeInFlight) {
    if (now - entry.createdAt > CHALLENGE_TTL_MS) {
      challengeInFlight.delete(key);
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
 * Generate a zero-knowledge proof of identity binding (CLIENT-SIDE)
 *
 * PRIVACY: The binding secret (derived from passkey PRF, OPAQUE export key,
 * or wallet signature) NEVER leaves the browser. Only the ZK proof and
 * binding commitment are returned. Auth mode is NOT revealed.
 *
 * @param bindingSecret - Auth-mode-specific secret as hex field
 * @param userIdHash - Hashed user ID as hex field
 * @param documentHash - Document commitment as hex field
 * @param options.nonce - Server-issued nonce for replay resistance
 */
export async function generateIdentityBindingProof(
  bindingSecret: string,
  userIdHash: string,
  documentHash: string,
  options: { nonce: string }
): Promise<ProofResult> {
  const startTime = performance.now();

  try {
    const result = await generateIdentityBindingProofNoir({
      bindingSecretField: bindingSecret,
      userIdHashField: userIdHash,
      documentHashField: documentHash,
      nonce: options.nonce,
    });
    recordProofSuccess("identity_binding", result);

    return {
      proof: bytesToBase64(result.proof),
      publicSignals: result.publicInputs,
      generationTimeMs: result.generationTimeMs,
    };
  } catch (error) {
    recordProofError("identity_binding", startTime);
    throw error;
  }
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
  cleanupStaleChallenges();

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

/**
 * Get all verified ZK proofs for the authenticated user.
 * Used by the developer view to display all proof types.
 */
export async function getAllProofs(): Promise<CryptoOutputs["getAllProofs"]> {
  try {
    return await trpc.crypto.getAllProofs.query();
  } catch (error) {
    throw new Error(
      error instanceof Error ? error.message : "Failed to get proofs"
    );
  }
}
