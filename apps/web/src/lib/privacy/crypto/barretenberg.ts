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

import { logger } from "@/lib/logging/logger";

let bbInstance: Barretenberg | null = null;
let bbInitPromise: Promise<Barretenberg> | null = null;

/**
 * Convert a bigint to a 32-byte big-endian Uint8Array (Fr field element)
 */
function bigIntToFr(value: bigint): Uint8Array {
  const reduced = value % BN254_FR_MODULUS;
  const hex = reduced.toString(16).padStart(64, "0");
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

const CRS_PATH =
  process.env.BB_CRS_PATH || process.env.CRS_PATH || "/tmp/.bb-crs";

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
 * Compatible with nodash::poseidon2 in Noir circuits
 */
export async function poseidon2Hash(values: bigint[]): Promise<bigint> {
  const bb = await getBarretenberg();
  const frValues = values.map(bigIntToFr);
  const result = await bb.poseidon2Hash({ inputs: frValues });
  // Convert result (Fr/Uint8Array) back to bigint
  const hex = Array.from(result.hash)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return BigInt(`0x${hex}`);
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
