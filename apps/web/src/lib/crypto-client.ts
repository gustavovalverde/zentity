/**
 * Crypto Client Library
 *
 * Typed client for interacting with FHE and ZK services via Next.js API routes.
 */

// Types for ZK proof operations
export interface ProofResult {
  proof: object;
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
}

export interface ServiceHealth {
  fhe: { status: string; service: string } | null;
  zk: { status: string; service: string } | null;
  allHealthy: boolean;
}

/**
 * Generate a zero-knowledge proof of age
 * @param birthYear - The user's birth year (will NOT be stored)
 * @param currentYear - The current year (defaults to current year)
 * @param minAge - Minimum age to prove (defaults to 18)
 */
export async function generateAgeProof(
  birthYear: number,
  currentYear: number = new Date().getFullYear(),
  minAge: number = 18
): Promise<ProofResult> {
  const response = await fetch("/api/crypto/generate-proof", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ birthYear, currentYear, minAge }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "Unknown error" }));
    throw new Error(error.error || `Failed to generate proof: ${response.status}`);
  }

  return response.json();
}

/**
 * Verify a zero-knowledge proof of age
 * @param proof - The proof object from generateAgeProof
 * @param publicSignals - The public signals from generateAgeProof
 */
export async function verifyAgeProof(
  proof: object,
  publicSignals: string[]
): Promise<VerifyResult> {
  const response = await fetch("/api/crypto/verify-proof", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ proof, publicSignals }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "Unknown error" }));
    throw new Error(error.error || `Failed to verify proof: ${response.status}`);
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
 * Store user's age proof after verification
 * @param proof - The ZK proof object
 * @param publicSignals - The public signals from the proof
 * @param isOver18 - Whether the user is over 18
 * @param generationTimeMs - Time to generate the ZK proof
 * @param fheData - Optional FHE encryption data
 */
export async function storeAgeProof(
  proof: object,
  publicSignals: string[],
  isOver18: boolean,
  generationTimeMs: number,
  fheData?: {
    dobCiphertext: string;
    fheClientKeyId: string;
    fheEncryptionTimeMs: number;
  }
): Promise<{ success: boolean; proofId: string }> {
  const response = await fetch("/api/user/proof", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      proof,
      publicSignals,
      isOver18,
      generationTimeMs,
      ...(fheData && {
        dobCiphertext: fheData.dobCiphertext,
        fheClientKeyId: fheData.fheClientKeyId,
        fheEncryptionTimeMs: fheData.fheEncryptionTimeMs,
      }),
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "Unknown error" }));
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
  proof?: object;
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
    const error = await response.json().catch(() => ({ error: "Unknown error" }));
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
    const error = await response.json().catch(() => ({ error: "Unknown error" }));
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
  minAge: number = 18
): Promise<VerifyAgeFHEResult> {
  const response = await fetch("/api/crypto/verify-age-fhe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ciphertext, currentYear, minAge }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "Unknown error" }));
    throw new Error(error.error || `Failed to verify age via FHE: ${response.status}`);
  }

  return response.json();
}
