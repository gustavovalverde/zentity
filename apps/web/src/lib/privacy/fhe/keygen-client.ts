"use client";

import { recordClientMetric } from "@/lib/observability/client-metrics";

/** SHA-256 fingerprint of an FHE public key; detects server-side key substitution. */
export async function computePublicKeyFingerprint(
  publicKey: Uint8Array
): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    Uint8Array.from(publicKey).buffer
  );
  const bytes = new Uint8Array(digest);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

interface WorkerRequest {
  id: number;
  type: "generate_key_material";
}

interface WorkerSuccess {
  durationMs: number;
  id: number;
  storedKeys: {
    clientKey: Uint8Array | ArrayBuffer;
    publicKey: Uint8Array | ArrayBuffer;
    serverKey: Uint8Array | ArrayBuffer;
    createdAt: string;
  };
  type: "result";
}

interface WorkerInitComplete {
  crossOriginIsolated: boolean;
  durationMs: number;
  threads: number;
  type: "init_complete";
}

interface WorkerError {
  id: number;
  message: string;
  type: "error";
}

type WorkerMessage = WorkerSuccess | WorkerInitComplete | WorkerError;

interface RawKeygenResult {
  durationMs: number;
  storedKeys: {
    clientKey: Uint8Array;
    publicKey: Uint8Array;
    serverKey: Uint8Array;
    createdAt: string;
  };
}

export interface FheKeygenResult extends RawKeygenResult {
  publicKeyFingerprint: string;
}

let workerInstance: Worker | null = null;
let nextId = 1;
let initSent = false;
const pending = new Map<
  number,
  { resolve: (value: RawKeygenResult) => void; reject: (error: Error) => void }
>();

function toUint8Array(value: Uint8Array | ArrayBuffer): Uint8Array {
  return value instanceof Uint8Array ? value : new Uint8Array(value);
}

function getWorker(): Worker {
  if (!workerInstance) {
    if (typeof Worker === "undefined") {
      throw new Error("Web Workers are not supported in this environment.");
    }
    workerInstance = new Worker(new URL("./keygen.worker", import.meta.url), {
      type: "module",
    });
    workerInstance.onmessage = (event: MessageEvent<WorkerMessage>) => {
      const message = event.data;

      if (message.type === "init_complete") {
        recordClientMetric({
          name: "client.tfhe.init",
          value: message.durationMs,
          attributes: {
            result: "ok",
            crossOriginIsolated: message.crossOriginIsolated,
            threads: message.threads,
          },
        });
        return;
      }

      const handlers = pending.get(message.id);
      if (!handlers) {
        return;
      }
      pending.delete(message.id);
      if (message.type === "error") {
        handlers.reject(new Error(message.message));
        return;
      }

      handlers.resolve({
        storedKeys: {
          clientKey: toUint8Array(message.storedKeys.clientKey),
          publicKey: toUint8Array(message.storedKeys.publicKey),
          serverKey: toUint8Array(message.storedKeys.serverKey),
          createdAt: message.storedKeys.createdAt,
        },
        durationMs: message.durationMs,
      });
    };
    workerInstance.onerror = (event) => {
      const error = new Error(
        event instanceof ErrorEvent
          ? event.message
          : "FHE worker failed unexpectedly"
      );
      for (const entry of pending.values()) {
        entry.reject(error);
      }
      pending.clear();
    };
  }
  return workerInstance;
}

export async function generateFheKeyMaterialInWorker(): Promise<FheKeygenResult> {
  const worker = getWorker();
  const id = nextId++;
  const payload: WorkerRequest = { id, type: "generate_key_material" };

  const raw = await new Promise<RawKeygenResult>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker.postMessage(payload);
  });

  const publicKeyFingerprint = await computePublicKeyFingerprint(
    raw.storedKeys.publicKey
  );
  return { ...raw, publicKeyFingerprint };
}

/**
 * Pre-warm the TFHE worker by spawning it and triggering WASM loading.
 * Sends an init message that loads the WASM module, compiles it, and
 * initializes the thread pool — so keygen starts instantly when needed.
 */
export function prewarmTfheWorker(): void {
  if (typeof Worker === "undefined") {
    return;
  }
  const worker = getWorker();
  if (!initSent) {
    initSent = true;
    worker.postMessage({ type: "init" });
  }
}
