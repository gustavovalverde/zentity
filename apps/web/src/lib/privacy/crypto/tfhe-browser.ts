"use client";

/**
 * TFHE Browser Client
 *
 * Loads TFHE-rs WASM from /tfhe/ (public folder) to avoid Turbopack
 * analyzing the large WASM asset during build. Assets are copied from
 * the npm package by scripts/setup-coep-assets.ts.
 */

import type { StoredFheKeys } from "@/lib/privacy/crypto/fhe-key-store";
import type { PasskeyEnrollmentContext } from "@/lib/privacy/crypto/secret-vault";

import { recordClientMetric } from "@/lib/observability/client-metrics";
import {
  getStoredFheKeys,
  persistFheKeyId as persistFheKeyIdInStore,
  storeFheKeys,
} from "@/lib/privacy/crypto/fhe-key-store";

import { generateFheKeyMaterialInWorker } from "./tfhe-keygen.client";

// Runtime types (matching the tfhe package's exported shapes).
interface TfheClientKey {
  serialize(): Uint8Array;
}

interface TfheCompressedPublicKey {
  serialize(): Uint8Array;
}

interface TfheCompressedServerKey {
  serialize(): Uint8Array;
}

interface TfheConfigBuilder {
  build(): unknown;
}

interface FheBool {
  decrypt(clientKey: TfheClientKey): boolean;
}

interface TfheModuleStatic {
  default(wasmPath?: string): Promise<unknown>;
  initThreadPool(threads: number): Promise<void>;
  init_panic_hook(): void;
  TfheConfigBuilder: {
    default(): TfheConfigBuilder;
  };
  TfheClientKey: {
    generate(config: unknown): TfheClientKey;
    deserialize(bytes: Uint8Array): TfheClientKey;
  };
  TfheCompressedPublicKey: {
    new: (clientKey: TfheClientKey) => TfheCompressedPublicKey;
    deserialize(bytes: Uint8Array): TfheCompressedPublicKey;
  };
  TfheCompressedServerKey: {
    new: (clientKey: TfheClientKey) => TfheCompressedServerKey;
    deserialize(bytes: Uint8Array): TfheCompressedServerKey;
  };
  FheBool: {
    deserialize(bytes: Uint8Array): FheBool;
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TfheModule = TfheModuleStatic;

export interface FheKeyMaterial {
  clientKey: TfheClientKey;
  publicKey: TfheCompressedPublicKey;
  serverKey: TfheCompressedServerKey;
  publicKeyBytes: Uint8Array;
  serverKeyBytes: Uint8Array;
  keyId?: string;
}

let tfheInitPromise: Promise<TfheModule> | null = null;

/**
 * WASM initialization retry configuration.
 * Allows recovery from transient network failures on slow connections.
 */
const WASM_INIT_MAX_RETRIES = 3;
const WASM_INIT_BASE_DELAY_MS = 500;

/**
 * Sleep helper for retry delays
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Attempt a single TFHE initialization.
 * Separated from retry logic for clarity.
 */
async function initTfheOnce(): Promise<TfheModule> {
  const start = performance.now();
  let result: "ok" | "error" = "ok";
  const multithreaded =
    globalThis.window !== undefined &&
    Boolean(globalThis.window.crossOriginIsolated);
  const tfheUrl = "/tfhe/tfhe.js";

  try {
    const tfhe = (await import(
      /* webpackIgnore: true */
      /* @vite-ignore */
      tfheUrl
    )) as TfheModule;

    // Initialize WASM (tfhe.js will load tfhe_bg.wasm from same directory)
    await tfhe.default();

    // Enable multi-threading if cross-origin isolated
    if (globalThis.window?.crossOriginIsolated) {
      const threads = navigator.hardwareConcurrency || 4;
      try {
        await tfhe.initThreadPool(threads);
      } catch {
        // Thread pool init can fail on some environments; continue single-threaded.
      }
    }

    try {
      tfhe.init_panic_hook();
    } catch {
      // Panic hook is optional in some runtimes.
    }

    return tfhe;
  } catch (error) {
    result = "error";
    throw error;
  } finally {
    recordClientMetric({
      name: "client.tfhe.load.duration",
      value: performance.now() - start,
      attributes: { result, multithreaded },
    });
  }
}

/**
 * Load TFHE from public folder with retry logic.
 * Clears the init promise on failure to allow recovery on subsequent calls.
 */
function loadTfhe(): Promise<TfheModule> {
  if (tfheInitPromise) {
    return tfheInitPromise;
  }

  tfheInitPromise = (async () => {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= WASM_INIT_MAX_RETRIES; attempt++) {
      try {
        return await initTfheOnce();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Don't retry on the last attempt
        if (attempt < WASM_INIT_MAX_RETRIES) {
          const delay = WASM_INIT_BASE_DELAY_MS * 2 ** (attempt - 1);
          recordClientMetric({
            name: "client.tfhe.load.retry",
            value: delay,
            attributes: { attempt, error: lastError.message },
          });
          await sleep(delay);
        }
      }
    }

    // All retries exhausted - clear promise to allow future retry
    tfheInitPromise = null;
    throw new Error(
      `TFHE WASM initialization failed after ${WASM_INIT_MAX_RETRIES} attempts: ${lastError?.message}`
    );
  })();

  return tfheInitPromise;
}

export async function getOrCreateFheKeyMaterial(): Promise<FheKeyMaterial> {
  const tfhe = await loadTfhe();
  const existing = await getStoredFheKeys();

  if (existing) {
    return {
      clientKey: tfhe.TfheClientKey.deserialize(existing.clientKey),
      publicKey: tfhe.TfheCompressedPublicKey.deserialize(existing.publicKey),
      serverKey: tfhe.TfheCompressedServerKey.deserialize(existing.serverKey),
      publicKeyBytes: existing.publicKey,
      serverKeyBytes: existing.serverKey,
      keyId: existing.keyId,
    };
  }

  throw new Error(
    "FHE keys are not initialized. Secure your encryption keys with a passkey first."
  );
}

export async function generateFheKeyMaterialForStorage(): Promise<{
  storedKeys: StoredFheKeys;
  durationMs: number;
}> {
  const start = performance.now();
  let result: "ok" | "error" = "ok";

  try {
    return await generateFheKeyMaterialInWorker();
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

export async function getOrCreateFheKeyRegistrationMaterial(params?: {
  enrollment?: PasskeyEnrollmentContext;
}): Promise<{
  publicKeyBytes: Uint8Array;
  serverKeyBytes: Uint8Array;
  keyId?: string;
}> {
  const existing = await getStoredFheKeys();
  if (existing) {
    return {
      publicKeyBytes: existing.publicKey,
      serverKeyBytes: existing.serverKey,
      keyId: existing.keyId,
    };
  }

  if (!params?.enrollment) {
    throw new Error(
      "FHE keys are not initialized. Secure your encryption keys with a passkey first."
    );
  }

  const { storedKeys } = await generateFheKeyMaterialForStorage();
  await storeFheKeys({ keys: storedKeys, enrollment: params.enrollment });
  return {
    publicKeyBytes: storedKeys.publicKey,
    serverKeyBytes: storedKeys.serverKey,
  };
}

export async function persistFheKeyId(keyId: string) {
  await persistFheKeyIdInStore(keyId);
}

export async function decryptFheBool(ciphertext: Uint8Array): Promise<boolean> {
  const tfhe = await loadTfhe();
  const keyMaterial = await getOrCreateFheKeyMaterial();
  const encrypted = tfhe.FheBool.deserialize(ciphertext);
  return encrypted.decrypt(keyMaterial.clientKey);
}
