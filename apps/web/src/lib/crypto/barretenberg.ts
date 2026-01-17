/**
 * Shared Barretenberg Singleton (SERVER-SIDE)
 *
 * Provides a single BarretenbergSync instance for server-side cryptographic operations.
 * Used by claim-hash.ts and nationality-merkle.ts for Poseidon2 hashing.
 *
 * Warmed up at server startup via instrumentation.ts to avoid cold-start latency.
 */

import "server-only";

import { BarretenbergSync } from "@aztec/bb.js";

import { logger } from "@/lib/logging/logger";

let bbInstance: BarretenbergSync | null = null;

export async function getBarretenberg(): Promise<BarretenbergSync> {
  bbInstance ??= await BarretenbergSync.initSingleton();
  return bbInstance;
}

/**
 * Warm up Barretenberg WASM module at server startup.
 * Called from instrumentation.ts to eliminate cold-start latency for
 * claim hash computation and Merkle tree operations.
 */
export async function warmupBarretenberg(): Promise<void> {
  const startTime = Date.now();
  await getBarretenberg();
  logger.info(
    { durationMs: Date.now() - startTime },
    "Barretenberg WASM preloaded"
  );
}
