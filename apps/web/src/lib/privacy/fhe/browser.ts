"use client";

/**
 * TFHE Browser Client
 *
 * Delegates FHE key generation to a Web Worker via keygen-client.
 * WASM assets are served from /tfhe/ (public folder) to avoid Turbopack
 * analyzing the large WASM asset during build. Assets are copied from
 * the npm package by scripts/setup-coep-assets.ts.
 */

import type { StoredFheKeys } from "./store";

import { recordClientMetric } from "@/lib/observability/client-metrics";

import { generateFheKeyMaterialInWorker } from "./keygen-client";

export async function generateFheKeyMaterialForStorage(): Promise<{
  storedKeys: StoredFheKeys;
  durationMs: number;
  publicKeyFingerprint: string;
}> {
  const start = performance.now();
  let result: "ok" | "error" = "ok";

  try {
    const workerResult = await generateFheKeyMaterialInWorker();
    recordClientMetric({
      name: "client.tfhe.keygen.worker.duration",
      value: workerResult.durationMs,
      attributes: { result: "ok" },
    });
    return workerResult;
  } catch (error) {
    result = "error";
    throw error;
  } finally {
    recordClientMetric({
      name: "client.tfhe.keygen.duration",
      value: performance.now() - start,
      attributes: { result },
    });
  }
}
