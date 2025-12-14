/**
 * Crypto Client Library
 *
 * Client-side ZK proof generation using Noir.js and Barretenberg.
 * Proofs are generated in the browser - sensitive data never leaves the device.
 */

"use client";

import type { inferRouterOutputs } from "@trpc/server";
import { bytesToBase64 } from "./base64";
import {
  generateAgeProofNoir,
  generateDocValidityProofNoir,
  generateFaceMatchProofNoir,
  generateNationalityProofNoir,
} from "./noir-prover";
import { trpc } from "./trpc/client";
import type { AppRouter } from "./trpc/routers/app";

type CryptoOutputs = inferRouterOutputs<AppRouter>["crypto"];
type GetUserProofOutput = CryptoOutputs["getUserProof"];
type GetUserProofFullOutput = Extract<
  NonNullable<GetUserProofOutput>,
  { proof: unknown }
>;
type GetUserProofSummaryOutput = Exclude<
  NonNullable<GetUserProofOutput>,
  { proof: unknown }
>;

// Types for ZK proof operations
export interface ProofResult {
  proof: string; // Base64 encoded UltraHonk ZK proof
  publicSignals: string[];
  generationTimeMs: number;
}

// Types for FHE operations
export interface EncryptDOBResult {
  ciphertext: string;
  clientKeyId: string;
  encryptionTimeMs: number;
}

export interface VerifyAgeFHEResult {
  isOver18: boolean;
  computationTimeMs: number;
}

export interface VerifyResult {
  isValid: boolean;
  verificationTimeMs: number;
  circuitType?: string;
  noirVersion?: string | null;
  circuitHash?: string | null;
  bbVersion?: string | null;
}

export type ServiceHealth = CryptoOutputs["health"];

export interface ChallengeResponse {
  nonce: string;
  circuitType: string;
  expiresAt: string;
}

/**
 * Generate a cryptographic nonce for client-side proof generation.
 * This doesn't require server auth - it's just a random value for replay resistance.
 */
export function generateClientNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return `0x${Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")}`;
}

/**
 * Generate a zero-knowledge proof of age (CLIENT-SIDE)
 *
 * The proof is generated entirely in the browser using a Web Worker.
 * Birth year NEVER leaves the device - only the cryptographic proof is returned.
 *
 * @param birthYear - The user's birth year (will NOT be stored or sent anywhere)
 * @param currentYear - The current year (defaults to current year)
 * @param minAge - Minimum age to prove (defaults to 18)
 */
export async function generateAgeProof(
  birthYear: number,
  currentYear: number = new Date().getFullYear(),
  minAge: number = 18,
  options?: {
    /**
     * Optional nonce to bind the proof to a server challenge.
     * When persisting proofs server-side, prefer a server-issued nonce from getProofChallenge().
     */
    nonce?: string;
  },
): Promise<ProofResult> {
  // Generate client-side nonce for replay resistance
  // This binds the proof to this specific request without needing server auth
  const nonce = options?.nonce ?? generateClientNonce();

  const result = await generateAgeProofNoir({
    birthYear,
    currentYear,
    minAge,
    nonce,
  });

  return {
    proof: bytesToBase64(result.proof),
    publicSignals: result.publicInputs,
    generationTimeMs: result.generationTimeMs,
  };
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
export async function generateNationalityProof(
  nationalityCode: string,
  groupName: string,
): Promise<ProofResult> {
  const nonce = generateClientNonce();

  const result = await generateNationalityProofNoir({
    nationalityCode,
    groupName,
    nonce,
  });

  return {
    proof: bytesToBase64(result.proof),
    publicSignals: result.publicInputs,
    generationTimeMs: result.generationTimeMs,
  };
}

/**
 * Converts current date to YYYYMMDD integer format.
 * Used for date comparisons in ZK circuits.
 */
function getTodayAsIntClient(): number {
  const today = new Date();
  return (
    today.getFullYear() * 10000 + (today.getMonth() + 1) * 100 + today.getDate()
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
  currentDate: number = getTodayAsIntClient(),
  options?: { nonce?: string },
): Promise<ProofResult> {
  const nonce = options?.nonce ?? generateClientNonce();

  const result = await generateDocValidityProofNoir({
    expiryDate,
    currentDate,
    nonce,
  });

  return {
    proof: bytesToBase64(result.proof),
    publicSignals: result.publicInputs,
    generationTimeMs: result.generationTimeMs,
  };
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
  options?: { nonce?: string },
): Promise<ProofResult> {
  const nonce = options?.nonce ?? generateClientNonce();

  const result = await generateFaceMatchProofNoir({
    similarityScore,
    threshold,
    nonce,
  });

  return {
    proof: bytesToBase64(result.proof),
    publicSignals: result.publicInputs,
    generationTimeMs: result.generationTimeMs,
  };
}

/**
 * Verify a zero-knowledge proof of age
 * @param proof - Base64 encoded UltraHonk ZK proof
 * @param publicInputs - The public inputs from the proof
 */
export async function verifyAgeProof(
  proof: string,
  publicInputs: string[],
): Promise<VerifyResult> {
  try {
    return await trpc.crypto.verifyProof.mutate({
      proof,
      publicInputs,
      circuitType: "age_verification",
    });
  } catch (error) {
    throw new Error(
      error instanceof Error ? error.message : "Failed to verify proof",
    );
  }
}

/**
 * Check health of crypto services
 */
export async function checkCryptoHealth(): Promise<ServiceHealth> {
  return trpc.crypto.health.query();
}

/**
 * Get a server-issued challenge nonce for replay-resistant proof generation.
 * The nonce must be included as a public input in the proof.
 *
 * NOTE: This requires authentication and is used for flows where server
 * validation of the nonce is required. For pre-auth flows (onboarding),
 * use client-side nonces via generateAgeProof() instead.
 *
 * @param circuitType - The type of circuit the nonce is for
 */
export async function getProofChallenge(
  circuitType:
    | "age_verification"
    | "doc_validity"
    | "nationality_membership"
    | "face_match",
): Promise<ChallengeResponse> {
  try {
    return await trpc.crypto.createChallenge.mutate({ circuitType });
  } catch (error) {
    throw new Error(
      error instanceof Error ? error.message : "Failed to get challenge",
    );
  }
}

/**
 * Store user's age proof after verification
 * @param proof - Base64 encoded UltraHonk ZK proof
 * @param publicSignals - The public signals from the proof
 * @param generationTimeMs - Time to generate the ZK proof
 * @param fheData - Optional FHE encryption data
 *
 * NOTE: isOver18 is intentionally NOT a parameter.
 * The server extracts this from publicSignals[3] after cryptographic verification.
 * (Index: [0]=current_year, [1]=min_age, [2]=nonce, [3]=is_old_enough)
 * This prevents malicious clients from claiming isOver18=true with invalid proofs.
 *
 * IMPORTANT: Persisted proofs must include a server-issued nonce from getProofChallenge().
 * Client-generated nonces are rejected by the storage endpoint.
 */
export async function storeAgeProof(
  proof: string,
  publicSignals: string[],
  generationTimeMs: number,
  fheData?: {
    dobCiphertext: string;
    fheClientKeyId: string;
    fheEncryptionTimeMs: number;
  },
): Promise<{
  success: boolean;
  proofId: string;
  isOver18: boolean;
  verificationTimeMs: number;
}> {
  try {
    return await trpc.crypto.storeAgeProof.mutate({
      proof,
      publicSignals,
      generationTimeMs,
      ...(fheData && {
        dobCiphertext: fheData.dobCiphertext,
        fheClientKeyId: fheData.fheClientKeyId,
        fheEncryptionTimeMs: fheData.fheEncryptionTimeMs,
      }),
    });
  } catch (error) {
    throw new Error(
      error instanceof Error ? error.message : "Failed to store proof",
    );
  }
}

/**
 * Get user's stored age proof
 * @param full - If true, returns full proof details including ciphertext
 */
export async function getUserProof(
  full: true,
): Promise<GetUserProofFullOutput | null>;
export async function getUserProof(
  full?: false,
): Promise<GetUserProofSummaryOutput | null>;
export async function getUserProof(
  full: boolean = false,
): Promise<GetUserProofOutput> {
  try {
    return await trpc.crypto.getUserProof.query({ full });
  } catch (error) {
    throw new Error(
      error instanceof Error ? error.message : "Failed to get proof",
    );
  }
}

// ============================================================================
// FHE (Fully Homomorphic Encryption) Functions
// ============================================================================

/**
 * Encrypt date of birth using FHE
 * The ciphertext can be stored and used for homomorphic age computations
 * @param birthYear - The user's birth year to encrypt
 */
export async function encryptDOB(birthYear: number): Promise<EncryptDOBResult> {
  try {
    return await trpc.crypto.encryptDob.mutate({ birthYear });
  } catch (error) {
    throw new Error(
      error instanceof Error ? error.message : "Failed to encrypt DOB",
    );
  }
}

/**
 * Verify age using FHE (homomorphic computation on encrypted DOB)
 * This performs a live computation on the encrypted data without decrypting it
 * @param ciphertext - The encrypted DOB ciphertext
 * @param currentYear - The current year (defaults to current year)
 * @param minAge - Minimum age to check (defaults to 18)
 */
export async function verifyAgeViaFHE(
  ciphertext: string,
  currentYear: number = new Date().getFullYear(),
  minAge: number = 18,
): Promise<VerifyAgeFHEResult> {
  try {
    return await trpc.crypto.verifyAgeFhe.mutate({
      ciphertext,
      currentYear,
      minAge,
    });
  } catch (error) {
    throw new Error(
      error instanceof Error ? error.message : "Failed to verify age via FHE",
    );
  }
}
