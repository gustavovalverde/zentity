/**
 * Noir Prover Web Worker Manager
 *
 * Manages communication with a Web Worker for off-main-thread proof generation.
 * This keeps the UI responsive during computationally intensive proof operations.
 *
 * PRIVACY: All sensitive data (birth year, nationality) is processed in the worker.
 * Only cryptographic proofs are returned.
 */

const ENABLE_WORKER_LOGS =
  process.env.NEXT_PUBLIC_NOIR_DEBUG === "true" &&
  (process.env.NODE_ENV === "development" ||
    process.env.NEXT_PUBLIC_APP_ENV === "local");

/**
 * Timeout for proof generation operations.
 * First proof can take longer due to WASM/CRS initialization.
 */
const WORKER_TIMEOUT_MS = 120_000; // 2 minutes

type ProofType =
  | "age"
  | "doc_validity"
  | "nationality"
  | "nationality_client"
  | "face_match";

export interface WorkerInitMessage {
  type: "init";
  origin: string;
}

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
  documentHashField: string; // Field element (hex) binding to document commitment
  claimHash: string; // Field element (hex) binding to signed claim
}

export interface DocValidityPayload {
  expiryDate: number;
  currentDate: number;
  nonce: string; // Hex string for replay resistance
  documentHashField: string;
  claimHash: string;
}

export interface NationalityProofPayload {
  nationalityCode: number; // ISO numeric (e.g., 276 for Germany)
  merkleRoot: string; // Pre-computed Merkle root
  pathElements: string[]; // Pre-computed path (8 elements)
  pathIndices: number[]; // Pre-computed indices (8 values, 0 or 1)
  nonce: string; // Hex string for replay resistance
  documentHashField: string;
  claimHash: string;
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
  documentHashField: string;
  claimHash: string;
}

export interface FaceMatchPayload {
  similarityScore: number; // Scaled integer 0-10000
  threshold: number; // Scaled integer 0-10000
  nonce: string; // Hex string for replay resistance
  documentHashField: string;
  claimHash: string;
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

const DEFAULT_WORKER_COUNT = 1;
const MAX_WORKER_COUNT = 4;

interface WorkerState {
  index: number;
  worker: Worker;
  inflight: number;
}

// Worker pool (optional parallelism)
let workerPool: WorkerState[] = [];
let workerPoolInitPromise: Promise<WorkerState[]> | null = null;

// Pending request callbacks with timeout tracking for proper cleanup
const pendingRequests = new Map<
  string,
  {
    resolve: (value: ProofOutput) => void;
    reject: (error: Error) => void;
    workerState: WorkerState;
    timeoutId: ReturnType<typeof setTimeout>;
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

function getDesiredWorkerCount(): number {
  const configured = Number.parseInt(
    process.env.NEXT_PUBLIC_NOIR_WORKERS ?? "",
    10
  );
  if (Number.isFinite(configured) && configured > 0) {
    return Math.min(configured, MAX_WORKER_COUNT);
  }
  return DEFAULT_WORKER_COUNT;
}

function createWorkerState(index: number): WorkerState {
  const newWorker = new Worker(
    new URL("./noir-prover.worker.ts", import.meta.url),
    { type: "module" }
  );
  if (globalThis.window !== undefined) {
    newWorker.postMessage({
      type: "init",
      origin: globalThis.window.location.origin,
    } satisfies WorkerInitMessage);
  }

  const state: WorkerState = {
    index,
    worker: newWorker,
    inflight: 0,
  };

  newWorker.onmessage = (
    event: MessageEvent<WorkerResponse | WorkerLogMessage>
  ) => {
    const data = event.data;

    // Handle log messages from worker (for diagnostics)
    if ("type" in data && data.type === "log") {
      if (ENABLE_WORKER_LOGS) {
        console.log(`[noir-worker:${data.stage}]`, data.msg, data);
      }
      return;
    }

    // Handle proof response messages
    const response = data as WorkerResponse;
    const { id, success, result, error } = response;
    const pending = pendingRequests.get(id);

    if (pending) {
      // Clear the timeout FIRST to prevent double-handling
      clearTimeout(pending.timeoutId);
      pendingRequests.delete(id);
      pending.workerState.inflight = Math.max(
        0,
        pending.workerState.inflight - 1
      );
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
    console.error("[noir-worker] Uncaught error:", error.message);
    for (const [id, pending] of pendingRequests) {
      if (pending.workerState.index !== state.index) {
        continue;
      }
      // Clear the timeout to prevent timer leaks
      clearTimeout(pending.timeoutId);
      pending.reject(new Error(`Worker error: ${error.message}`));
      pendingRequests.delete(id);
    }
    state.inflight = 0;
  };

  return state;
}

/**
 * Initialize the worker pool (lazy, thread-safe).
 * Clears the init promise on failure to allow retry.
 */
function getWorkerPool(): Promise<WorkerState[]> {
  if (workerPool.length > 0) {
    return Promise.resolve(workerPool);
  }
  if (workerPoolInitPromise) {
    return workerPoolInitPromise;
  }

  try {
    const desired = getDesiredWorkerCount();
    workerPool = Array.from({ length: desired }, (_, index) =>
      createWorkerState(index)
    );
    workerPoolInitPromise = Promise.resolve(workerPool);
  } catch (error) {
    // Clear promise on failure to allow retry on next call
    workerPoolInitPromise = null;
    throw error;
  }

  return workerPoolInitPromise;
}

async function getLeastBusyWorker(): Promise<WorkerState> {
  const pool = await getWorkerPool();
  return pool.reduce(
    (best, current) => (current.inflight < best.inflight ? current : best),
    pool[0]
  );
}

/**
 * Generate a unique request ID
 */
function generateId(): string {
  return crypto.randomUUID();
}

async function sendProofRequest(
  type: Exclude<ProofType, "health_check">,
  payload: WorkerRequest["payload"]
): Promise<ProofOutput> {
  const workerState = await getLeastBusyWorker();
  const id = generateId();

  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      if (pendingRequests.delete(id)) {
        workerState.inflight = Math.max(0, workerState.inflight - 1);
      }
      reject(
        new Error(
          `ZK proof generation timed out after ${WORKER_TIMEOUT_MS / 1000}s. This may indicate WASM loading issues in your browser.`
        )
      );
    }, WORKER_TIMEOUT_MS);

    // Store raw resolve/reject with timeoutId - cleanup happens in onmessage/onerror
    pendingRequests.set(id, {
      workerState,
      resolve,
      reject,
      timeoutId,
    });

    workerState.inflight += 1;
    try {
      workerState.worker.postMessage({ id, type, payload });
    } catch (error) {
      if (pendingRequests.delete(id)) {
        workerState.inflight = Math.max(0, workerState.inflight - 1);
      }
      clearTimeout(timeoutId);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

/**
 * Generate an age proof using the Web Worker
 */
export function generateAgeProofWorker(
  payload: AgeProofPayload
): Promise<ProofOutput> {
  return sendProofRequest("age", payload);
}

export function generateFaceMatchProofWorker(
  payload: FaceMatchPayload
): Promise<ProofOutput> {
  return sendProofRequest("face_match", payload);
}

/**
 * Generate a document validity proof using the Web Worker
 */
export function generateDocValidityProofWorker(
  payload: DocValidityPayload
): Promise<ProofOutput> {
  return sendProofRequest("doc_validity", payload);
}

/**
 * Generate a nationality membership proof using the Web Worker
 * (with pre-computed Merkle path)
 */
function _generateNationalityProofWorker(
  payload: NationalityProofPayload
): Promise<ProofOutput> {
  return sendProofRequest("nationality", payload);
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
export function generateNationalityProofClientWorker(
  payload: NationalityClientPayload
): Promise<ProofOutput> {
  return sendProofRequest("nationality_client", payload);
}

/**
 * Terminate the worker (cleanup)
 */
function _terminateWorker(): void {
  for (const state of workerPool) {
    state.worker.terminate();
  }
  workerPool = [];
  workerPoolInitPromise = null;
  pendingRequests.clear();
}

/**
 * Health check result
 */
