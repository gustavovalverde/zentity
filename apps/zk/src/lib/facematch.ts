/**
 * Face Match ZK proof operations
 *
 * Generates and verifies Groth16 proofs for face similarity verification.
 * Proves that a similarity score >= threshold without revealing exact score.
 */

import * as snarkjs from "snarkjs";
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ARTIFACTS_DIR = join(__dirname, "../../artifacts/facematch");

// Load verification key once
let verificationKey: object | null = null;

function getVerificationKey(): object {
  if (!verificationKey) {
    const vkPath = join(ARTIFACTS_DIR, "verification_key.json");
    if (!existsSync(vkPath)) {
      throw new Error(`Face match verification key not found at ${vkPath}`);
    }
    verificationKey = JSON.parse(readFileSync(vkPath, "utf-8"));
  }
  return verificationKey!;
}

export interface FaceMatchProofInput {
  /** Similarity score as float 0.0-1.0 (will be scaled to 0-10000) */
  similarityScore: number;
  /** Threshold as float 0.0-1.0 (will be scaled to 0-10000) */
  threshold: number;
}

export interface FaceMatchProofResult {
  proof: snarkjs.Groth16Proof;
  publicSignals: string[];
  generationTimeMs: number;
  /** The threshold used (scaled back to 0.0-1.0) */
  threshold: number;
  /** Whether the proof indicates a match */
  isMatch: boolean;
}

export interface FaceMatchVerifyResult {
  isValid: boolean;
  verificationTimeMs: number;
  /** The threshold from public signals (scaled to 0.0-1.0) */
  threshold: number;
}

/**
 * Scale a float (0.0-1.0) to integer (0-10000) for circuit input
 */
function scaleToCircuit(value: number): number {
  return Math.round(value * 10000);
}

/**
 * Scale an integer (0-10000) back to float (0.0-1.0)
 */
function scaleFromCircuit(value: number): number {
  return value / 10000;
}

/**
 * Generate a Groth16 proof for face match verification
 *
 * Proves: similarityScore >= threshold without revealing exact score
 */
export async function generateFaceMatchProof(
  input: FaceMatchProofInput
): Promise<FaceMatchProofResult> {
  const startTime = Date.now();

  // Validate inputs
  if (input.similarityScore < 0 || input.similarityScore > 1) {
    throw new Error("similarityScore must be between 0.0 and 1.0");
  }
  if (input.threshold < 0 || input.threshold > 1) {
    throw new Error("threshold must be between 0.0 and 1.0");
  }

  const wasmPath = join(ARTIFACTS_DIR, "facematch.wasm");
  const zkeyPath = join(ARTIFACTS_DIR, "facematch_final.zkey");

  if (!existsSync(wasmPath)) {
    throw new Error(`Face match WASM not found at ${wasmPath}`);
  }
  if (!existsSync(zkeyPath)) {
    throw new Error(`Face match zkey not found at ${zkeyPath}`);
  }

  // Scale inputs to circuit format (0-10000)
  const scaledScore = scaleToCircuit(input.similarityScore);
  const scaledThreshold = scaleToCircuit(input.threshold);

  // snarkjs expects string inputs for the circuit
  const circuitInput = {
    similarityScore: scaledScore.toString(),
    threshold: scaledThreshold.toString(),
  };

  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    circuitInput,
    wasmPath,
    zkeyPath
  );

  const generationTimeMs = Date.now() - startTime;

  // Public signals: [isMatch, threshold]
  const isMatch = publicSignals[0] === "1";

  return {
    proof,
    publicSignals,
    generationTimeMs,
    threshold: input.threshold,
    isMatch,
  };
}

/**
 * Verify a face match Groth16 proof
 */
export async function verifyFaceMatchProof(
  proof: snarkjs.Groth16Proof,
  publicSignals: string[]
): Promise<FaceMatchVerifyResult> {
  const startTime = Date.now();

  const vk = getVerificationKey();
  const isValid = await snarkjs.groth16.verify(vk, publicSignals, proof);

  const verificationTimeMs = Date.now() - startTime;

  // Extract threshold from public signals (index 1)
  const scaledThreshold = parseInt(publicSignals[1] || "0", 10);
  const threshold = scaleFromCircuit(scaledThreshold);

  return {
    isValid,
    verificationTimeMs,
    threshold,
  };
}

/**
 * Export proof as Solidity calldata (for on-chain verification)
 */
export async function exportFaceMatchSolidityCalldata(
  proof: snarkjs.Groth16Proof,
  publicSignals: string[]
): Promise<string> {
  return await snarkjs.groth16.exportSolidityCallData(proof, publicSignals);
}
