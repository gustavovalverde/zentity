/**
 * Document Validity ZK proof operations
 *
 * Generates and verifies Groth16 proofs for document expiry verification.
 * Proves that expiryDate > currentDate without revealing actual expiry date.
 */

import * as snarkjs from "snarkjs";
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ARTIFACTS_DIR = join(__dirname, "../../artifacts/docvalidity");

// Load verification key once
let verificationKey: object | null = null;

function getVerificationKey(): object {
  if (!verificationKey) {
    const vkPath = join(ARTIFACTS_DIR, "verification_key.json");
    if (!existsSync(vkPath)) {
      throw new Error(`Document validity verification key not found at ${vkPath}`);
    }
    verificationKey = JSON.parse(readFileSync(vkPath, "utf-8"));
  }
  return verificationKey!;
}

export interface DocValidityProofInput {
  /** Expiry date as YYYYMMDD integer (e.g., 20251231 for Dec 31, 2025) */
  expiryDate: number;
  /** Current date as YYYYMMDD integer (e.g., 20241205 for Dec 5, 2024) */
  currentDate: number;
}

export interface DocValidityProofResult {
  proof: snarkjs.Groth16Proof;
  publicSignals: string[];
  generationTimeMs: number;
  /** The current date used for verification (public) */
  currentDate: number;
  /** Whether the document is valid (not expired) */
  isValid: boolean;
}

export interface DocValidityVerifyResult {
  isValid: boolean;
  verificationTimeMs: number;
  /** The current date from public signals */
  currentDate: number;
  /** Whether the proof indicates document is valid */
  proofIsValid: boolean;
}

/**
 * Parse a date string (YYYY-MM-DD) to YYYYMMDD integer
 */
export function dateToInt(dateStr: string): number {
  const cleaned = dateStr.replace(/-/g, "");
  return parseInt(cleaned, 10);
}

/**
 * Get current date as YYYYMMDD integer
 */
export function getCurrentDateInt(): number {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return parseInt(`${year}${month}${day}`, 10);
}

/**
 * Validate date integer format (YYYYMMDD)
 */
function isValidDateInt(dateInt: number): boolean {
  const str = String(dateInt);
  if (str.length !== 8) return false;

  const year = parseInt(str.slice(0, 4), 10);
  const month = parseInt(str.slice(4, 6), 10);
  const day = parseInt(str.slice(6, 8), 10);

  if (year < 1900 || year > 2200) return false;
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;

  return true;
}

/**
 * Generate a Groth16 proof for document validity verification
 *
 * Proves: expiryDate > currentDate without revealing actual expiry date
 */
export async function generateDocValidityProof(
  input: DocValidityProofInput
): Promise<DocValidityProofResult> {
  const startTime = Date.now();

  // Validate inputs
  if (!isValidDateInt(input.expiryDate)) {
    throw new Error("expiryDate must be in YYYYMMDD format (e.g., 20251231)");
  }
  if (!isValidDateInt(input.currentDate)) {
    throw new Error("currentDate must be in YYYYMMDD format (e.g., 20241205)");
  }

  const wasmPath = join(ARTIFACTS_DIR, "docvalidity.wasm");
  const zkeyPath = join(ARTIFACTS_DIR, "docvalidity_final.zkey");

  if (!existsSync(wasmPath)) {
    throw new Error(`Document validity WASM not found at ${wasmPath}`);
  }
  if (!existsSync(zkeyPath)) {
    throw new Error(`Document validity zkey not found at ${zkeyPath}`);
  }

  // snarkjs expects string inputs for the circuit
  const circuitInput = {
    expiryDate: input.expiryDate.toString(),
    currentDate: input.currentDate.toString(),
  };

  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    circuitInput,
    wasmPath,
    zkeyPath
  );

  const generationTimeMs = Date.now() - startTime;

  // Public signals: [isValid, currentDate]
  const isValid = publicSignals[0] === "1";

  return {
    proof,
    publicSignals,
    generationTimeMs,
    currentDate: input.currentDate,
    isValid,
  };
}

/**
 * Verify a document validity Groth16 proof
 */
export async function verifyDocValidityProof(
  proof: snarkjs.Groth16Proof,
  publicSignals: string[]
): Promise<DocValidityVerifyResult> {
  const startTime = Date.now();

  const vk = getVerificationKey();
  const isValid = await snarkjs.groth16.verify(vk, publicSignals, proof);

  const verificationTimeMs = Date.now() - startTime;

  // Extract values from public signals
  // [isValid, currentDate]
  const proofIsValid = publicSignals[0] === "1";
  const currentDate = parseInt(publicSignals[1] || "0", 10);

  return {
    isValid,
    verificationTimeMs,
    currentDate,
    proofIsValid,
  };
}

/**
 * Export proof as Solidity calldata (for on-chain verification)
 */
export async function exportDocValiditySolidityCalldata(
  proof: snarkjs.Groth16Proof,
  publicSignals: string[]
): Promise<string> {
  return await snarkjs.groth16.exportSolidityCallData(proof, publicSignals);
}
