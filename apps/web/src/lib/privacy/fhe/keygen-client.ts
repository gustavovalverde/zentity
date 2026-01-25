"use client";

interface WorkerRequest {
  id: number;
  type: "generate_key_material";
}

interface WorkerSuccess {
  id: number;
  type: "result";
  storedKeys: {
    clientKey: Uint8Array | ArrayBuffer;
    publicKey: Uint8Array | ArrayBuffer;
    serverKey: Uint8Array | ArrayBuffer;
    createdAt: string;
  };
  durationMs: number;
}

interface WorkerError {
  id: number;
  type: "error";
  message: string;
}

export interface FheKeygenResult {
  storedKeys: {
    clientKey: Uint8Array;
    publicKey: Uint8Array;
    serverKey: Uint8Array;
    createdAt: string;
  };
  durationMs: number;
}

let workerInstance: Worker | null = null;
let nextId = 1;
const pending = new Map<
  number,
  { resolve: (value: FheKeygenResult) => void; reject: (error: Error) => void }
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
    workerInstance.onmessage = (
      event: MessageEvent<WorkerSuccess | WorkerError>
    ) => {
      const message = event.data;
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

export function generateFheKeyMaterialInWorker(): Promise<FheKeygenResult> {
  const worker = getWorker();
  const id = nextId++;
  const payload: WorkerRequest = { id, type: "generate_key_material" };

  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker.postMessage(payload);
  });
}

/**
 * Pre-warm the TFHE worker by spawning it early.
 * This loads the WASM module in the background, reducing latency
 * when key generation is actually needed.
 *
 * Call this on pages where users are likely to create accounts.
 */
export function prewarmTfheWorker(): void {
  if (typeof Worker === "undefined") {
    return;
  }
  getWorker();
}
