/**
 * snarkjs wrapper for ZK proof operations
 */

import * as snarkjs from "snarkjs";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ARTIFACTS_DIR = join(__dirname, "../../artifacts");

// Load verification key once
let verificationKey: object | null = null;

function getVerificationKey(): object {
  if (!verificationKey) {
    const vkPath = join(ARTIFACTS_DIR, "verification_key.json");
    verificationKey = JSON.parse(readFileSync(vkPath, "utf-8"));
  }
  return verificationKey!;
}

export interface ProofInput {
  birthYear: number;
  currentYear: number;
  minAge: number;
}

export interface ProofResult {
  proof: snarkjs.Groth16Proof;
  publicSignals: string[];
  generationTimeMs: number;
}

export interface VerifyResult {
  isValid: boolean;
  verificationTimeMs: number;
}

/**
 * Generate a Groth16 proof for age verification
 */
export async function generateProof(input: ProofInput): Promise<ProofResult> {
  const startTime = Date.now();

  const wasmPath = join(ARTIFACTS_DIR, "circuit.wasm");
  const zkeyPath = join(ARTIFACTS_DIR, "circuit_final.zkey");

  // snarkjs expects string inputs for the circuit
  const circuitInput = {
    birthYear: input.birthYear.toString(),
    currentYear: input.currentYear.toString(),
    minAge: input.minAge.toString(),
  };

  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    circuitInput,
    wasmPath,
    zkeyPath
  );

  const generationTimeMs = Date.now() - startTime;

  return {
    proof,
    publicSignals,
    generationTimeMs,
  };
}

/**
 * Verify a Groth16 proof
 */
export async function verifyProof(
  proof: snarkjs.Groth16Proof,
  publicSignals: string[]
): Promise<VerifyResult> {
  const startTime = Date.now();

  const vk = getVerificationKey();
  const isValid = await snarkjs.groth16.verify(vk, publicSignals, proof);

  const verificationTimeMs = Date.now() - startTime;

  return {
    isValid,
    verificationTimeMs,
  };
}

/**
 * Export proof as Solidity calldata (for on-chain verification)
 */
export async function exportSolidityCalldata(
  proof: snarkjs.Groth16Proof,
  publicSignals: string[]
): Promise<string> {
  return await snarkjs.groth16.exportSolidityCallData(proof, publicSignals);
}
