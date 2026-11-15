/**
 * Shared Barretenberg Singleton (SERVER-SIDE)
 *
 * Provides a single Barretenberg instance for server-side cryptographic operations.
 * Includes Poseidon2 hashing compatible with Noir circuits.
 *
 * Warmed up at server startup via instrumentation.ts to avoid cold-start latency.
 */

import "server-only";

import { BackendType, Barretenberg, BN254_FR_MODULUS } from "@aztec/bb.js";
import { bytesToBigInt, numberToBytes } from "viem";

import { env } from "@/env";
import { logger } from "@/lib/logging/logger";

let bbInstance: Barretenberg | null = null;
let bbInitPromise: Promise<Barretenberg> | null = null;

/**
 * Convert a bigint to a 32-byte big-endian Uint8Array (Fr field element)
 */
export function bigIntToFr(value: bigint): Uint8Array {
  return numberToBytes(value % BN254_FR_MODULUS, { size: 32 });
}

const CRS_PATH = env.BB_CRS_PATH;

export function getBarretenberg(): Promise<Barretenberg> {
  if (bbInstance) {
    return Promise.resolve(bbInstance);
  }

  if (!bbInitPromise) {
    // Force WASM backend - native backend fails in containers without bb binary
    bbInitPromise = Barretenberg.new({
      crsPath: CRS_PATH,
      backend: BackendType.Wasm,
    }).then((api) => {
      bbInstance = api;
      return api;
    });

    bbInitPromise.catch((error) => {
      logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        "Failed to initialize Barretenberg WASM"
      );
      bbInitPromise = null;
    });
  }

  return bbInitPromise;
}

/**
 * Poseidon2 hash function for server-side use
 * Matches `Poseidon2::hash(inputs, inputs.len())` from noir-lang/poseidon in the Noir circuits
 */
export async function poseidon2Hash(values: bigint[]): Promise<bigint> {
  const bb = await getBarretenberg();
  const frValues = values.map(bigIntToFr);
  const result = await bb.poseidon2Hash({ inputs: frValues });
  return bytesToBigInt(result.hash);
}

/**
 * Warm up Barretenberg WASM module at server startup.
 * Called from instrumentation.ts to eliminate cold-start latency for
 * claim hash computation and Merkle tree operations.
 */
export async function warmupBarretenberg(): Promise<void> {
  const startTime = Date.now();
  try {
    await getBarretenberg();
    logger.info(
      { durationMs: Date.now() - startTime, crsPath: CRS_PATH },
      "Barretenberg WASM preloaded"
    );
  } catch (error) {
    logger.error(
      {
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startTime,
        crsPath: CRS_PATH,
      },
      "Failed to preload Barretenberg WASM"
    );
    throw error;
  }
}
