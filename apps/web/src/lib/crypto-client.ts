/**
 * Crypto Client Library
 *
 * Client-side ZK proof generation using Noir.js and Barretenberg.
 * Proofs are generated in the browser - sensitive data never leaves the device.
 */

import { bytesToBase64 } from "./base64";
import {
  generateAgeProofNoir,
  generateDocValidityProofNoir,
  generateFaceMatchProofNoir,
  generateNationalityProofNoir,
} from "./noir-prover";

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

export interface ServiceHealth {
  fhe: { status: string; service: string } | null;
  allHealthy: boolean;
}

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

function getTodayAsIntClient(): number {
  const today = new Date();
  return (
    today.getFullYear() * 10000 + (today.getMonth() + 1) * 100 + today.getDate()
  );
}

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
  const response = await fetch("/api/crypto/verify-proof", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      proof,
      publicInputs,
      circuitType: "age_verification",
    }),
  });

  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ error: "Unknown error" }));
    throw new Error(
      error.error || `Failed to verify proof: ${response.status}`,
    );
  }

  return response.json();
}

/**
 * Check health of crypto services
 */
export async function checkCryptoHealth(): Promise<ServiceHealth> {
  const response = await fetch("/api/crypto/health");

  if (!response.ok) {
    throw new Error("Failed to check crypto service health");
  }

  return response.json();
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
  const response = await fetch("/api/crypto/challenge", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ circuitType }),
  });

  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ error: "Unknown error" }));
    throw new Error(
      error.error || `Failed to get challenge: ${response.status}`,
    );
  }

  return response.json();
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
  const response = await fetch("/api/user/proof", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      proof,
      publicSignals,
      generationTimeMs,
      ...(fheData && {
        dobCiphertext: fheData.dobCiphertext,
        fheClientKeyId: fheData.fheClientKeyId,
        fheEncryptionTimeMs: fheData.fheEncryptionTimeMs,
      }),
    }),
  });

  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ error: "Unknown error" }));
    throw new Error(error.error || `Failed to store proof: ${response.status}`);
  }

  return response.json();
}

/**
 * Get user's stored age proof
 * @param full - If true, returns full proof details including ciphertext
 */
export async function getUserProof(full: boolean = false): Promise<{
  proofId: string;
  isOver18: boolean;
  createdAt: string;
  generationTimeMs: number;
  // Full details (only when full=true)
  proof?: string; // Base64 encoded UltraHonk ZK proof
  publicSignals?: string[];
  dobCiphertext?: string;
  fheClientKeyId?: string;
  fheEncryptionTimeMs?: number;
} | null> {
  const url = full ? "/api/user/proof?full=true" : "/api/user/proof";
  const response = await fetch(url);

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ error: "Unknown error" }));
    throw new Error(error.error || `Failed to get proof: ${response.status}`);
  }

  return response.json();
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
  const response = await fetch("/api/crypto/encrypt-dob", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ birthYear }),
  });

  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ error: "Unknown error" }));
    throw new Error(error.error || `Failed to encrypt DOB: ${response.status}`);
  }

  return response.json();
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
  const response = await fetch("/api/crypto/verify-age-fhe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ciphertext, currentYear, minAge }),
  });

  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ error: "Unknown error" }));
    throw new Error(
      error.error || `Failed to verify age via FHE: ${response.status}`,
    );
  }

  return response.json();
}
