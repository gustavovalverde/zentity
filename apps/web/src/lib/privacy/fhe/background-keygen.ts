"use client";

import type { FheKeygenResult } from "./keygen-client";

import { recordClientMetric } from "@/lib/observability/client-metrics";

interface BackgroundKeygenResult {
  keyId: string;
  storedKeys: FheKeygenResult["storedKeys"];
}

type BackgroundState = "idle" | "running" | "done" | "error";

let bgPromise: Promise<BackgroundKeygenResult | null> | null = null;
let bgResult: BackgroundKeygenResult | null = null;
let bgState: BackgroundState = "idle";

async function runBackgroundKeygen(): Promise<BackgroundKeygenResult | null> {
  const start = performance.now();
  try {
    const { prewarmTfheWorker, generateFheKeyMaterialInWorker } = await import(
      "./keygen-client"
    );
    prewarmTfheWorker();

    const keygen = await generateFheKeyMaterialInWorker();

    const { fetchMsgpack } = await import(
      "@/lib/privacy/utils/binary-transport"
    );
    const registration = await fetchMsgpack<{ keyId: string }>(
      "/api/fhe/keys/register",
      {
        serverKey: keygen.storedKeys.serverKey,
        publicKey: keygen.storedKeys.publicKey,
      },
      { credentials: "include" }
    );

    const result: BackgroundKeygenResult = {
      storedKeys: keygen.storedKeys,
      keyId: registration.keyId,
    };

    bgResult = result;
    bgState = "done";

    recordClientMetric({
      name: "client.tfhe.bg_keygen.duration",
      value: performance.now() - start,
      attributes: { result: "ok", source: "background" },
    });

    return result;
  } catch {
    bgState = "error";
    recordClientMetric({
      name: "client.tfhe.bg_keygen.duration",
      value: performance.now() - start,
      attributes: { result: "error", source: "background" },
    });
    return null;
  }
}

/**
 * Start background FHE key generation and registration.
 * Idempotent — calling multiple times has no effect.
 */
export function startBackgroundKeygen(): void {
  if (bgState !== "idle") {
    return;
  }
  bgState = "running";
  bgPromise = runBackgroundKeygen();
}

/**
 * Get pre-generated keys if available. Consume-once semantics:
 * the cached result is cleared after the first successful return.
 *
 * If background keygen is in-flight, briefly awaits (5s timeout)
 * before returning null to avoid duplicate keygen.
 */
export async function getPreGeneratedKeys(): Promise<BackgroundKeygenResult | null> {
  if (bgResult) {
    const result = bgResult;
    bgResult = null;
    return result;
  }

  if (bgPromise && bgState === "running") {
    const result = await Promise.race([
      bgPromise,
      new Promise<null>((resolve) => {
        setTimeout(() => resolve(null), 5000);
      }),
    ]);
    if (result) {
      bgResult = null;
      return result;
    }
  }

  return null;
}

/**
 * Reset all background keygen state.
 * Called on sign-out to clear key material from memory.
 */
export function resetBackgroundKeygen(): void {
  bgPromise = null;
  bgResult = null;
  bgState = "idle";
}
