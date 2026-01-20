/**
 * Noir Client-Side Prover Library
 *
 * Generates zero-knowledge proofs in the browser using Noir.js and Barretenberg (bb.js).
 * This enables true zero-knowledge: sensitive data (birth year, etc.) never leaves the user's device.
 *
 * Uses UltraHonk proof system with universal setup for fast client-side proving.
 *
 * Proof generation runs in a Web Worker to keep the UI responsive.
 */

import {
  generateAgeProofWorker,
  generateDocValidityProofWorker,
  generateFaceMatchProofWorker,
  generateIdentityBindingProofWorker,
  generateNationalityProofClientWorker,
} from "./noir-worker-manager";

// Types for proof operations
interface NoirProofResult {
  proof: Uint8Array;
  publicInputs: string[];
  generationTimeMs: number;
}

interface AgeProofInput {
  /** DOB encoded as days since 1900-01-01 (UTC). */
  dobDays: number;
  /** Current date encoded as days since 1900-01-01 (UTC). */
  currentDays: number;
  /** Minimum age threshold encoded in days. */
  minAgeDays: number;
  nonce: string; // Hex nonce for replay resistance
  documentHashField: string;
  claimHash: string;
}

interface DocValidityInput {
  expiryDate: number; // YYYYMMDD format
  currentDate: number; // YYYYMMDD format
  nonce: string; // Hex nonce for replay resistance
  documentHashField: string;
  claimHash: string;
}

interface FaceMatchInput {
  similarityScore: number; // Scaled integer 0-10000
  threshold: number; // Scaled integer 0-10000
  nonce: string; // Hex nonce for replay resistance
  documentHashField: string;
  claimHash: string;
}

interface NationalityProofInput {
  nationalityCode: string; // ISO alpha-3 (e.g., "DEU" for Germany)
  groupName: string; // Group to prove membership (e.g., "EU", "SCHENGEN")
  nonce: string; // Hex nonce for replay resistance
  documentHashField: string;
  claimHash: string;
}

interface IdentityBindingInput {
  bindingSecretField: string; // Derived from auth mode (PRF/export key/signature)
  userIdHashField: string; // Hash of user ID
  documentHashField: string; // Document commitment
  nonce: string; // Hex nonce for replay resistance
}

/**
 * Generate an age verification proof in the browser
 *
 * Uses a Web Worker to keep the UI responsive during proof generation.
 *
 * @param input - DOB days, current days, minimum age (days), and nonce from challenge API
 * @returns Proof and public inputs that can be sent to server for verification
 *
 * @example
 * // First get a challenge nonce
 * const challenge = await getProofChallenge('age_verification');
 *
 * const result = await generateAgeProofNoir({
 *   dobDays: 32872, // 1990-01-01 (example)
 *   currentDays: 46000, // today (example)
 *   minAgeDays: 6574, // 18y (example)
 *   nonce: challenge.nonce
 * });
 * // result.publicInputs contains the verification result
 * // Birth year NEVER leaves the browser
 */
export async function generateAgeProofNoir(
  input: AgeProofInput
): Promise<NoirProofResult> {
  if (globalThis.window === undefined) {
    throw new Error("ZK proofs can only be generated in the browser");
  }

  const startTime = performance.now();

  const result = await generateAgeProofWorker({
    dobDays: input.dobDays,
    currentDays: input.currentDays,
    minAgeDays: input.minAgeDays,
    nonce: input.nonce,
    documentHashField: input.documentHashField,
    claimHash: input.claimHash,
  });

  return {
    proof: result.proof,
    publicInputs: result.publicInputs,
    generationTimeMs: performance.now() - startTime,
  };
}

/**
 * Generate a document validity proof in the browser
 *
 * Uses a Web Worker to keep the UI responsive during proof generation.
 *
 * @param input - Expiry date, current date in YYYYMMDD format, and nonce from challenge API
 * @returns Proof that document is valid without revealing expiry date
 *
 * @example
 * // First get a challenge nonce
 * const challenge = await getProofChallenge('doc_validity');
 *
 * const result = await generateDocValidityProofNoir({
 *   expiryDate: 20271231, // December 31, 2027
 *   currentDate: 20251212, // December 12, 2025
 *   nonce: challenge.nonce
 * });
 */
export async function generateDocValidityProofNoir(
  input: DocValidityInput
): Promise<NoirProofResult> {
  if (globalThis.window === undefined) {
    throw new Error("ZK proofs can only be generated in the browser");
  }

  const startTime = performance.now();

  const result = await generateDocValidityProofWorker({
    expiryDate: input.expiryDate,
    currentDate: input.currentDate,
    nonce: input.nonce,
    documentHashField: input.documentHashField,
    claimHash: input.claimHash,
  });

  return {
    proof: result.proof,
    publicInputs: result.publicInputs,
    generationTimeMs: performance.now() - startTime,
  };
}

export async function generateFaceMatchProofNoir(
  input: FaceMatchInput
): Promise<NoirProofResult> {
  if (globalThis.window === undefined) {
    throw new Error("ZK proofs can only be generated in the browser");
  }

  const startTime = performance.now();

  const result = await generateFaceMatchProofWorker({
    similarityScore: input.similarityScore,
    threshold: input.threshold,
    nonce: input.nonce,
    documentHashField: input.documentHashField,
    claimHash: input.claimHash,
  });

  return {
    proof: result.proof,
    publicInputs: result.publicInputs,
    generationTimeMs: performance.now() - startTime,
  };
}

/**
 * Generate a nationality membership proof in the browser (FULLY CLIENT-SIDE)
 *
 * PRIVACY: Nationality NEVER leaves the browser. The Merkle path is computed
 * in the Web Worker and the proof is generated entirely client-side.
 *
 * @param input - Nationality code (ISO alpha-3), group name, and nonce
 * @returns Proof of membership without revealing nationality
 *
 * @example
 * const challenge = await getProofChallenge("nationality_membership");
 * const result = await generateNationalityProofNoir({
 *   nationalityCode: "DEU", // Germany
 *   groupName: "EU",
 *   nonce: challenge.nonce,
 * });
 * // Proves German nationality is in EU without revealing "Germany"
 */
export async function generateNationalityProofNoir(
  input: NationalityProofInput
): Promise<NoirProofResult> {
  if (globalThis.window === undefined) {
    throw new Error("ZK proofs can only be generated in the browser");
  }

  const startTime = performance.now();

  const result = await generateNationalityProofClientWorker({
    nationalityCode: input.nationalityCode,
    groupName: input.groupName,
    nonce: input.nonce,
    documentHashField: input.documentHashField,
    claimHash: input.claimHash,
  });

  return {
    proof: result.proof,
    publicInputs: result.publicInputs,
    generationTimeMs: performance.now() - startTime,
  };
}

/**
 * Generate an identity binding proof in the browser
 *
 * PRIVACY: The binding secret (derived from passkey PRF, OPAQUE export key,
 * or wallet signature) NEVER leaves the browser. Only the ZK proof is returned.
 * Auth mode is NOT revealed in the proof - privacy enhancement.
 *
 * @param input - Binding secret, user ID hash, document hash, and nonce
 * @returns Proof of identity binding without revealing the binding secret or auth mode
 *
 * @example
 * const challenge = await getProofChallenge("identity_binding");
 * const result = await generateIdentityBindingProofNoir({
 *   bindingSecretField: "0x...",
 *   userIdHashField: "0x...",
 *   documentHashField: "0x...",
 *   nonce: challenge.nonce,
 * });
 */
export async function generateIdentityBindingProofNoir(
  input: IdentityBindingInput
): Promise<NoirProofResult> {
  if (globalThis.window === undefined) {
    throw new Error("ZK proofs can only be generated in the browser");
  }

  const startTime = performance.now();

  const result = await generateIdentityBindingProofWorker({
    bindingSecretField: input.bindingSecretField,
    userIdHashField: input.userIdHashField,
    documentHashField: input.documentHashField,
    nonce: input.nonce,
  });

  return {
    proof: result.proof,
    publicInputs: result.publicInputs,
    generationTimeMs: performance.now() - startTime,
  };
}

/**
 * Get today's date as YYYYMMDD integer
 */
export function getTodayAsInt(): number {
  const today = new Date();
  return (
    today.getFullYear() * 10_000 +
    (today.getMonth() + 1) * 100 +
    today.getDate()
  );
}
