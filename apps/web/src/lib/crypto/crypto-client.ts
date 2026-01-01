/**
 * Crypto Client Library
 *
 * Client-side ZK proof generation using Noir.js and Barretenberg.
 * Proofs are generated in the browser - sensitive data never leaves the device.
 */

"use client";

import type { inferRouterOutputs } from "@trpc/server";
import type {
  AgeProofFull,
  AgeProofSummary,
} from "@/lib/crypto/age-proof-types";
import type { PasskeyEnrollmentContext } from "@/lib/crypto/fhe-key-store";
import type { AppRouter } from "@/lib/trpc/routers/app";

import {
  decryptFheBool,
  getOrCreateFheKeyMaterial,
  getOrCreateFheKeyMaterialWithPasskey,
  persistFheKeyId,
} from "@/lib/crypto/tfhe-browser";
import { trpc } from "@/lib/trpc/client";
import { bytesToBase64 } from "@/lib/utils";
import {
  generateAgeProofNoir,
  generateDocValidityProofNoir,
  generateFaceMatchProofNoir,
  generateNationalityProofNoir,
} from "@/lib/zk";

type CryptoOutputs = inferRouterOutputs<AppRouter>["crypto"];

// Types for ZK proof operations
interface ProofResult {
  proof: string; // Base64 encoded UltraHonk ZK proof
  publicSignals: string[];
  generationTimeMs: number;
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
  options: {
    /** Server-issued nonce to bind the proof to a challenge. */
    nonce: string;
    /** Poseidon field element for document hash commitment. */
    documentHashField: string;
    /** Poseidon claim hash from signed OCR claim. */
    claimHash: string;
  },
): Promise<ProofResult> {
  const nonce = options.nonce;

  const result = await generateAgeProofNoir({
    birthYear,
    currentYear,
    minAge,
    nonce,
    documentHashField: options.documentHashField,
    claimHash: options.claimHash,
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
async function _generateNationalityProof(
  nationalityCode: string,
  groupName: string,
  nonce: string,
  documentHashField: string,
  claimHash: string,
): Promise<ProofResult> {
  const result = await generateNationalityProofNoir({
    nationalityCode,
    groupName,
    nonce,
    documentHashField,
    claimHash,
  });

  return {
    proof: bytesToBase64(result.proof),
    publicSignals: result.publicInputs,
    generationTimeMs: result.generationTimeMs,
  };
}

export async function generateNationalityProof(
  nationalityCode: string,
  groupName: string,
  options: { nonce: string; documentHashField: string; claimHash: string },
): Promise<ProofResult> {
  return _generateNationalityProof(
    nationalityCode,
    groupName,
    options.nonce,
    options.documentHashField,
    options.claimHash,
  );
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
  options: { nonce: string; documentHashField: string; claimHash: string },
): Promise<ProofResult> {
  const nonce = options.nonce;

  const result = await generateDocValidityProofNoir({
    expiryDate,
    currentDate,
    nonce,
    documentHashField: options.documentHashField,
    claimHash: options.claimHash,
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
  options: { nonce: string; documentHashField: string; claimHash: string },
): Promise<ProofResult> {
  const nonce = options.nonce;

  const result = await generateFaceMatchProofNoir({
    similarityScore,
    threshold,
    nonce,
    documentHashField: options.documentHashField,
    claimHash: options.claimHash,
  });

  return {
    proof: bytesToBase64(result.proof),
    publicSignals: result.publicInputs,
    generationTimeMs: result.generationTimeMs,
  };
}

/**
 * Check health of crypto services
 */
async function _checkCryptoHealth(): Promise<ServiceHealth> {
  return trpc.crypto.health.query();
}

export async function getSignedClaims(
  documentId?: string | null,
): Promise<CryptoOutputs["getSignedClaims"]> {
  return documentId
    ? trpc.crypto.getSignedClaims.query({ documentId })
    : trpc.crypto.getSignedClaims.query();
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
 * @param documentId - Optional document ID to bind proof storage to a specific document
 * NOTE: isOver18 is intentionally NOT a parameter.
 * The server extracts this from publicSignals[3] after cryptographic verification.
 * (Index: [0]=current_year, [1]=min_age, [2]=nonce, [3]=is_old_enough)
 * This prevents malicious clients from claiming isOver18=true with invalid proofs.
 *
 * IMPORTANT: Persisted proofs must include a server-issued nonce from getProofChallenge().
 * Client-generated nonces are rejected by the storage endpoint.
 */
export async function storeProof(
  circuitType:
    | "age_verification"
    | "doc_validity"
    | "nationality_membership"
    | "face_match",
  proof: string,
  publicSignals: string[],
  generationTimeMs: number,
  documentId?: string | null,
): Promise<{
  success: boolean;
  proofId: string;
  proofHash: string;
  verificationTimeMs: number;
}> {
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
      error instanceof Error ? error.message : "Failed to store proof",
    );
  }
}

/**
 * Get user's stored age proof
 * @param full - If true, returns full proof details including ciphertext
 */
export async function getUserProof(full: true): Promise<AgeProofFull | null>;
export async function getUserProof(
  full?: false,
): Promise<AgeProofSummary | null>;
export async function getUserProof(
  full: boolean = false,
): Promise<AgeProofFull | AgeProofSummary | null> {
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

export async function ensureFheKeyRegistration(params?: {
  enrollment?: PasskeyEnrollmentContext;
}): Promise<{
  keyId: string;
}> {
  const keyMaterial = params?.enrollment
    ? await getOrCreateFheKeyMaterialWithPasskey(params.enrollment)
    : await getOrCreateFheKeyMaterial();
  if (keyMaterial.keyId) {
    return { keyId: keyMaterial.keyId };
  }

  const response = await trpc.crypto.registerFheKey.mutate({
    serverKey: keyMaterial.serverKeyB64,
    publicKey: keyMaterial.publicKeyB64,
  });
  await persistFheKeyId(response.keyId);

  return { keyId: response.keyId };
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
  ciphertext: string,
  keyId: string,
  currentYear: number = new Date().getFullYear(),
  minAge: number = 18,
): Promise<VerifyAgeFHEResult> {
  try {
    const start = Date.now();
    const result = await trpc.crypto.verifyAgeFhe.mutate({
      ciphertext,
      currentYear,
      minAge,
      keyId,
    });
    const isOver18 = await decryptFheBool(result.resultCiphertext);
    return {
      isOver18,
      computationTimeMs: Date.now() - start,
    };
  } catch (error) {
    throw new Error(
      error instanceof Error ? error.message : "Failed to verify age via FHE",
    );
  }
}
