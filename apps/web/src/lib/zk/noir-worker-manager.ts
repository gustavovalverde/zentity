/**
 * Noir Prover Web Worker Manager
 *
 * Manages communication with a Web Worker for off-main-thread proof generation.
 * This keeps the UI responsive during computationally intensive proof operations.
 *
 * PRIVACY: All sensitive data (birth year, nationality) is processed in the worker.
 * Only cryptographic proofs are returned.
 */

/**
 * Timeout for proof generation operations.
 * First proof can take longer due to WASM/CRS initialization.
 */
const WORKER_TIMEOUT_MS = 120_000; // 2 minutes

/**
 * Timeout for health check operations.
 */
const HEALTH_CHECK_TIMEOUT_MS = 30_000; // 30 seconds

type ProofType =
  | "age"
  | "doc_validity"
  | "nationality"
  | "nationality_client"
  | "face_match"
  | "health_check";

/**
 * Empty payload for health check requests
 */
export type HealthCheckPayload = Record<string, never>;

export interface WorkerRequest {
  id: string;
  type: ProofType;
  payload:
    | AgeProofPayload
    | DocValidityPayload
    | NationalityProofPayload
    | NationalityClientPayload
    | FaceMatchPayload
    | HealthCheckPayload;
}

export interface AgeProofPayload {
  birthYear: number;
  currentYear: number;
  minAge: number;
  nonce: string; // Hex string for replay resistance
}

export interface DocValidityPayload {
  expiryDate: number;
  currentDate: number;
  nonce: string; // Hex string for replay resistance
}

export interface NationalityProofPayload {
  nationalityCode: number; // ISO numeric (e.g., 276 for Germany)
  merkleRoot: string; // Pre-computed Merkle root
  pathElements: string[]; // Pre-computed path (8 elements)
  pathIndices: number[]; // Pre-computed indices (8 values, 0 or 1)
  nonce: string; // Hex string for replay resistance
}

/**
 * Client-side nationality proof payload
 * Nationality code and Merkle path are computed INSIDE the worker.
 * This ensures nationality NEVER leaves the browser.
 */
export interface NationalityClientPayload {
  nationalityCode: string; // ISO alpha-3 (e.g., "DEU" for Germany)
  groupName: string; // Group to prove membership in (e.g., "EU", "SCHENGEN")
  nonce: string; // Hex string for replay resistance
}

export interface FaceMatchPayload {
  similarityScore: number; // Scaled integer 0-10000
  threshold: number; // Scaled integer 0-10000
  nonce: string; // Hex string for replay resistance
}

export interface WorkerResponse {
  id: string;
  success: boolean;
  result?: {
    proof: number[]; // Uint8Array transferred as array
    publicInputs: string[];
  };
  error?: string;
}

interface ProofOutput {
  proof: Uint8Array;
  publicInputs: string[];
}

// Singleton worker instance
let worker: Worker | null = null;
let workerInitPromise: Promise<Worker> | null = null;

// Pending request callbacks
const pendingRequests = new Map<
  string,
  {
    resolve: (value: ProofOutput) => void;
    reject: (error: Error) => void;
  }
>();

/**
 * Worker log message type for diagnostic logging
 */
interface WorkerLogMessage {
  type: "log";
  stage: string;
  msg: string;
  timestamp: string;
  [key: string]: unknown;
}

/**
 * Initialize the worker (lazy, singleton)
 */
async function getWorker(): Promise<Worker> {
  if (worker) return worker;
  if (workerInitPromise) return workerInitPromise;

  workerInitPromise = new Promise((resolve, reject) => {
    try {
      // Create worker from the worker file
      const newWorker = new Worker(
        new URL("./noir-prover.worker.ts", import.meta.url),
        { type: "module" },
      );

      newWorker.onmessage = (
        event: MessageEvent<WorkerResponse | WorkerLogMessage>,
      ) => {
        const data = event.data;

        // Handle log messages from worker (for diagnostics)
        if ("type" in data && data.type === "log") {
          // biome-ignore lint/suspicious/noConsole: Diagnostic logging for production debugging
          console.log(`[noir-worker:${data.stage}]`, data.msg, data);
          return;
        }

        // Handle proof response messages
        const response = data as WorkerResponse;
        const { id, success, result, error } = response;
        const pending = pendingRequests.get(id);

        if (pending) {
          pendingRequests.delete(id);
          if (success && result) {
            pending.resolve({
              proof: new Uint8Array(result.proof),
              publicInputs: result.publicInputs,
            });
          } else {
            pending.reject(new Error(error || "Unknown worker error"));
          }
        }
      };

      newWorker.onerror = (error) => {
        // biome-ignore lint/suspicious/noConsole: Error logging for debugging
        console.error("[noir-worker] Uncaught error:", error.message);
        // Reject all pending requests
        for (const [id, pending] of pendingRequests) {
          pending.reject(new Error(`Worker error: ${error.message}`));
          pendingRequests.delete(id);
        }
      };

      worker = newWorker;
      resolve(newWorker);
    } catch (error) {
      reject(error);
    }
  });

  return workerInitPromise;
}

/**
 * Generate a unique request ID
 */
function generateId(): string {
  return crypto.randomUUID();
}

/**
 * Generate an age proof using the Web Worker
 */
export async function generateAgeProofWorker(
  payload: AgeProofPayload,
): Promise<ProofOutput> {
  const w = await getWorker();
  const id = generateId();

  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      pendingRequests.delete(id);
      reject(
        new Error(
          `ZK proof generation timed out after ${WORKER_TIMEOUT_MS / 1000}s. This may indicate WASM loading issues in your browser.`,
        ),
      );
    }, WORKER_TIMEOUT_MS);

    pendingRequests.set(id, {
      resolve: (value) => {
        clearTimeout(timeoutId);
        resolve(value);
      },
      reject: (error) => {
        clearTimeout(timeoutId);
        reject(error);
      },
    });

    const request: WorkerRequest = {
      id,
      type: "age",
      payload,
    };

    w.postMessage(request);
  });
}

export async function generateFaceMatchProofWorker(
  payload: FaceMatchPayload,
): Promise<ProofOutput> {
  const w = await getWorker();
  const id = generateId();

  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      pendingRequests.delete(id);
      reject(
        new Error(
          `ZK proof generation timed out after ${WORKER_TIMEOUT_MS / 1000}s. This may indicate WASM loading issues in your browser.`,
        ),
      );
    }, WORKER_TIMEOUT_MS);

    pendingRequests.set(id, {
      resolve: (value) => {
        clearTimeout(timeoutId);
        resolve(value);
      },
      reject: (error) => {
        clearTimeout(timeoutId);
        reject(error);
      },
    });

    const request: WorkerRequest = {
      id,
      type: "face_match",
      payload,
    };

    w.postMessage(request);
  });
}

/**
 * Generate a document validity proof using the Web Worker
 */
export async function generateDocValidityProofWorker(
  payload: DocValidityPayload,
): Promise<ProofOutput> {
  const w = await getWorker();
  const id = generateId();

  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      pendingRequests.delete(id);
      reject(
        new Error(
          `ZK proof generation timed out after ${WORKER_TIMEOUT_MS / 1000}s. This may indicate WASM loading issues in your browser.`,
        ),
      );
    }, WORKER_TIMEOUT_MS);

    pendingRequests.set(id, {
      resolve: (value) => {
        clearTimeout(timeoutId);
        resolve(value);
      },
      reject: (error) => {
        clearTimeout(timeoutId);
        reject(error);
      },
    });

    const request: WorkerRequest = {
      id,
      type: "doc_validity",
      payload,
    };

    w.postMessage(request);
  });
}

/**
 * Generate a nationality membership proof using the Web Worker
 * (with pre-computed Merkle path)
 */
async function _generateNationalityProofWorker(
  payload: NationalityProofPayload,
): Promise<ProofOutput> {
  const w = await getWorker();
  const id = generateId();

  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      pendingRequests.delete(id);
      reject(
        new Error(
          `ZK proof generation timed out after ${WORKER_TIMEOUT_MS / 1000}s. This may indicate WASM loading issues in your browser.`,
        ),
      );
    }, WORKER_TIMEOUT_MS);

    pendingRequests.set(id, {
      resolve: (value) => {
        clearTimeout(timeoutId);
        resolve(value);
      },
      reject: (error) => {
        clearTimeout(timeoutId);
        reject(error);
      },
    });

    const request: WorkerRequest = {
      id,
      type: "nationality",
      payload,
    };

    w.postMessage(request);
  });
}

/**
 * Generate a nationality membership proof with CLIENT-SIDE Merkle computation
 *
 * PRIVACY: The nationality code is processed entirely in the Web Worker.
 * It NEVER leaves the browser - only the ZK proof is returned.
 *
 * @param payload.nationalityCode - ISO alpha-3 code (e.g., "DEU" for Germany)
 * @param payload.groupName - Group to prove membership (e.g., "EU", "SCHENGEN")
 * @param payload.nonce - Hex string for replay resistance
 */
export async function generateNationalityProofClientWorker(
  payload: NationalityClientPayload,
): Promise<ProofOutput> {
  const w = await getWorker();
  const id = generateId();

  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      pendingRequests.delete(id);
      reject(
        new Error(
          `ZK proof generation timed out after ${WORKER_TIMEOUT_MS / 1000}s. This may indicate WASM loading issues in your browser.`,
        ),
      );
    }, WORKER_TIMEOUT_MS);

    pendingRequests.set(id, {
      resolve: (value) => {
        clearTimeout(timeoutId);
        resolve(value);
      },
      reject: (error) => {
        clearTimeout(timeoutId);
        reject(error);
      },
    });

    const request: WorkerRequest = {
      id,
      type: "nationality_client",
      payload,
    };

    w.postMessage(request);
  });
}

/**
 * Terminate the worker (cleanup)
 */
function _terminateWorker(): void {
  if (worker) {
    worker.terminate();
    worker = null;
    workerInitPromise = null;
    pendingRequests.clear();
  }
}

/**
 * Health check result
 */
export interface WorkerHealthStatus {
  workerReady: boolean;
  modulesLoaded: boolean;
  error?: string;
}

/**
 * Check if the worker is healthy and modules can be loaded.
 * Useful for diagnosing production issues.
 */
export async function checkWorkerHealth(): Promise<WorkerHealthStatus> {
  try {
    const w = await getWorker();
    const id = generateId();

    return new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        pendingRequests.delete(id);
        resolve({
          workerReady: true,
          modulesLoaded: false,
          error: `Health check timed out after ${HEALTH_CHECK_TIMEOUT_MS / 1000}s - WASM modules may not be accessible`,
        });
      }, HEALTH_CHECK_TIMEOUT_MS);

      pendingRequests.set(id, {
        resolve: () => {
          clearTimeout(timeoutId);
          resolve({ workerReady: true, modulesLoaded: true });
        },
        reject: (error) => {
          clearTimeout(timeoutId);
          resolve({
            workerReady: true,
            modulesLoaded: false,
            error: error.message,
          });
        },
      });

      w.postMessage({ id, type: "health_check", payload: {} });
    });
  } catch (error) {
    return {
      workerReady: false,
      modulesLoaded: false,
      error: error instanceof Error ? error.message : "Worker creation failed",
    };
  }
}
