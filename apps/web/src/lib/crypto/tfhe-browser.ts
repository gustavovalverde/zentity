"use client";

/**
 * TFHE Browser Client
 *
 * Loads TFHE-rs WASM from /tfhe/ (public folder) to avoid Turbopack
 * analyzing the large WASM asset during build. Assets are copied from
 * the npm package by scripts/setup-coep-assets.ts.
 */

import type {
  PasskeyEnrollmentContext,
  StoredFheKeys,
} from "@/lib/crypto/fhe-key-store";

import {
  getStoredFheKeys,
  persistFheKeyId as persistFheKeyIdInStore,
  storeFheKeys,
} from "@/lib/crypto/fhe-key-store";
import { recordClientMetric } from "@/lib/observability/client-metrics";
import { base64ToBytes, bytesToBase64 } from "@/lib/utils/base64";

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
  publicKeyB64: string;
  serverKeyB64: string;
  keyId?: string;
}

let tfheInitPromise: Promise<TfheModule> | null = null;

/**
 * Load TFHE from public folder instead of node_modules.
 */
function loadTfhe(): Promise<TfheModule> {
  if (!tfheInitPromise) {
    tfheInitPromise = (async () => {
      const start = performance.now();
      let result: "ok" | "error" = "ok";
      const multithreaded =
        typeof window !== "undefined" && Boolean(window.crossOriginIsolated);
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
        if (typeof window !== "undefined" && window.crossOriginIsolated) {
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
    })();
  }

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
      publicKeyB64: bytesToBase64(existing.publicKey),
      serverKeyB64: bytesToBase64(existing.serverKey),
      keyId: existing.keyId,
    };
  }

  throw new Error(
    "FHE keys are not initialized. Secure your encryption keys with a passkey first."
  );
}

export async function getOrCreateFheKeyMaterialWithPasskey(
  enrollment: PasskeyEnrollmentContext
): Promise<FheKeyMaterial> {
  const tfhe = await loadTfhe();
  const existing = await getStoredFheKeys();
  if (existing) {
    return {
      clientKey: tfhe.TfheClientKey.deserialize(existing.clientKey),
      publicKey: tfhe.TfheCompressedPublicKey.deserialize(existing.publicKey),
      serverKey: tfhe.TfheCompressedServerKey.deserialize(existing.serverKey),
      publicKeyB64: bytesToBase64(existing.publicKey),
      serverKeyB64: bytesToBase64(existing.serverKey),
      keyId: existing.keyId,
    };
  }

  const start = performance.now();
  let result: "ok" | "error" = "ok";

  const config = tfhe.TfheConfigBuilder.default().build();
  const clientKey = tfhe.TfheClientKey.generate(config);
  const publicKey = tfhe.TfheCompressedPublicKey.new(clientKey);
  const serverKey = tfhe.TfheCompressedServerKey.new(clientKey);

  const stored: StoredFheKeys = {
    clientKey: clientKey.serialize(),
    publicKey: publicKey.serialize(),
    serverKey: serverKey.serialize(),
    createdAt: new Date().toISOString(),
  };

  try {
    await storeFheKeys({ keys: stored, enrollment });
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

  return {
    clientKey,
    publicKey,
    serverKey,
    publicKeyB64: bytesToBase64(stored.publicKey),
    serverKeyB64: bytesToBase64(stored.serverKey),
  };
}

export async function persistFheKeyId(keyId: string) {
  await persistFheKeyIdInStore(keyId);
}

export async function decryptFheBool(ciphertextB64: string): Promise<boolean> {
  const tfhe = await loadTfhe();
  const keyMaterial = await getOrCreateFheKeyMaterial();
  const bytes = base64ToBytes(ciphertextB64);
  const encrypted = tfhe.FheBool.deserialize(bytes);
  return encrypted.decrypt(keyMaterial.clientKey);
}
