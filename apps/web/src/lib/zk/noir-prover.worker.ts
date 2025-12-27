/**
 * Noir Prover Web Worker
 *
 * Runs proof generation off the main thread to keep the UI responsive.
 * Dynamically imports Noir.js and bb.js when first proof is requested.
 *
 * PRIVACY: All sensitive data (birth year, nationality) stays in this worker.
 * Only cryptographic proofs are returned to the main thread.
 */

import type {
  AgeProofPayload,
  DocValidityPayload,
  FaceMatchPayload,
  NationalityClientPayload,
  NationalityProofPayload,
  WorkerInitMessage,
  WorkerRequest,
  WorkerResponse,
} from "./noir-worker-manager";

import { Buffer } from "buffer";

// Circuit artifacts - these are bundled with the worker
import ageCircuit from "@/noir-circuits/age_verification/artifacts/age_verification.json";
import docValidityCircuit from "@/noir-circuits/doc_validity/artifacts/doc_validity.json";
import faceMatchCircuit from "@/noir-circuits/face_match/artifacts/face_match.json";
import nationalityCircuit from "@/noir-circuits/nationality_membership/artifacts/nationality_membership.json";

import { COUNTRY_CODES, COUNTRY_GROUPS, TREE_DEPTH } from "./nationality-data";

const ENABLE_WORKER_LOGS =
  process.env.NEXT_PUBLIC_NOIR_DEBUG === "true" &&
  (process.env.NODE_ENV === "development" ||
    process.env.NEXT_PUBLIC_APP_ENV === "local");

/**
 * Diagnostic logging (development only).
 * Logs are forwarded to the main thread when explicitly enabled.
 */
function logWorker(
  stage: string,
  msg: string,
  data?: Record<string, unknown>,
): void {
  if (!ENABLE_WORKER_LOGS) return;
  const timestamp = new Date().toISOString();
  const payload = data
    ? { type: "log" as const, stage, msg, timestamp, ...data }
    : { type: "log" as const, stage, msg, timestamp };
  try {
    self.postMessage(payload);
  } catch {
    // Ignore if postMessage fails
  }
}

// Module cache for lazy loading
interface ModuleCache {
  Noir: typeof import("@noir-lang/noir_js").Noir;
  UltraHonkBackend: typeof import("@aztec/bb.js").UltraHonkBackend;
  Fr: typeof import("@aztec/bb.js").Fr;
  BarretenbergSync: typeof import("@aztec/bb.js").BarretenbergSync;
}

let moduleCache: ModuleCache | null = null;
let bbInstance: Awaited<
  ReturnType<typeof import("@aztec/bb.js").BarretenbergSync.initSingleton>
> | null = null;

type CircuitName =
  | "age_verification"
  | "doc_validity"
  | "face_match"
  | "nationality_membership";

const noirInstanceCache = new Map<
  CircuitName,
  import("@noir-lang/noir_js").Noir
>();
const proverBackendCache = new Map<
  CircuitName,
  import("@aztec/bb.js").UltraHonkBackend
>();
let workerQueue: Promise<void> = Promise.resolve();

const MAX_THREADS = 8;
let loggedIsolationFallback = false;

/**
 * Local path for bb.js WASM (copied by setup-coep-assets.mjs).
 * Serving locally avoids CDN latency and improves reliability.
 * Note: bb.js appends "-threads" when multi-threading is enabled,
 * so we pass the base path and it requests "barretenberg-threads.wasm.gz".
 */
const BB_WASM_PATH = "/bb/barretenberg.wasm.gz";

function getIsolationSupport() {
  const sharedArrayBuffer = typeof SharedArrayBuffer !== "undefined";
  const crossOriginIsolated = globalThis.crossOriginIsolated === true;
  return {
    sharedArrayBuffer,
    crossOriginIsolated,
    canUseThreads: sharedArrayBuffer && crossOriginIsolated,
  };
}

function getThreadCount(): number {
  const { canUseThreads } = getIsolationSupport();
  if (!canUseThreads) return 1;
  const available = self.navigator?.hardwareConcurrency ?? 4;
  return Math.max(1, Math.min(MAX_THREADS, available));
}

const bbLogger = (msg: string) => {
  logWorker("bb", msg);
};

// bb.js expects `Buffer` to exist in the browser/worker runtime.
// In the browser, `buffer` provides a Uint8Array-backed Buffer that doesn't
// include BigInt read/write helpers, so we polyfill the minimum required API.
function ensureBigIntUint8ArrayHelpers() {
  const proto = Uint8Array.prototype as unknown as {
    writeBigUInt64BE?: (value: bigint, offset?: number) => number;
    readBigUInt64BE?: (offset?: number) => bigint;
  };

  if (typeof proto.writeBigUInt64BE !== "function") {
    Object.defineProperty(Uint8Array.prototype, "writeBigUInt64BE", {
      value(value: bigint, offset = 0) {
        let v = BigInt(value);
        for (let i = 7; i >= 0; i--) {
          (this as Uint8Array)[offset + i] = Number(v & BigInt(255));
          v >>= BigInt(8);
        }
        return offset + 8;
      },
      writable: true,
      configurable: true,
    });
  }

  if (typeof proto.readBigUInt64BE !== "function") {
    Object.defineProperty(Uint8Array.prototype, "readBigUInt64BE", {
      value(offset = 0) {
        let v = BigInt(0);
        for (let i = 0; i < 8; i++) {
          v = (v << BigInt(8)) + BigInt((this as Uint8Array)[offset + i]);
        }
        return v;
      },
      writable: true,
      configurable: true,
    });
  }
}

ensureBigIntUint8ArrayHelpers();
globalThis.Buffer = Buffer;

// Some bundlers load module workers via `blob:` URLs. In that case, `fetch("/...")`
// fails because the base URL is non-hierarchical. Normalize absolute-path fetches
// to an origin-qualified URL when possible.
let fetchOrigin: string | null = null;
const originalFetch =
  typeof globalThis.fetch === "function" ? globalThis.fetch : null;

function setFetchOrigin(origin: string | null) {
  if (!originalFetch || !origin || origin === "null") return;
  if (fetchOrigin === origin) return;
  fetchOrigin = origin;

  const originalFetchBound = originalFetch.bind(globalThis);
  const wrappedFetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    // Fix absolute paths for blob: URL workers
    if (typeof input === "string" && input.startsWith("/")) {
      return originalFetchBound(`${origin}${input}`, init);
    }
    if (input instanceof URL && input.pathname.startsWith("/")) {
      return originalFetchBound(
        new URL(`${origin}${input.pathname}${input.search}`),
        init,
      );
    }
    return originalFetchBound(input, init);
  }) as typeof fetch;

  if ("preconnect" in originalFetch) {
    wrappedFetch.preconnect = originalFetch.preconnect;
  }

  globalThis.fetch = wrappedFetch;
}

if (originalFetch) {
  try {
    const origin = new URL(globalThis.location.href).origin;
    setFetchOrigin(origin);
  } catch {
    // Origin will be injected from main thread when running under blob: URLs.
  }
}

/**
 * Initialize Noir.js and bb.js (lazy, once)
 */
async function getModules(): Promise<ModuleCache> {
  if (moduleCache) {
    logWorker("init", "Using cached modules");
    return moduleCache;
  }

  logWorker("init", "Starting module initialization");

  try {
    logWorker("import", "Importing @noir-lang/noir_js...");
    const noirImportStart = performance.now();
    const noirModule = await import("@noir-lang/noir_js");
    logWorker("import", "@noir-lang/noir_js loaded", {
      durationMs: Math.round(performance.now() - noirImportStart),
    });

    logWorker("import", "Importing @aztec/bb.js...");
    const bbImportStart = performance.now();
    const bbModule = await import("@aztec/bb.js");
    logWorker("import", "@aztec/bb.js loaded", {
      durationMs: Math.round(performance.now() - bbImportStart),
    });

    moduleCache = {
      Noir: noirModule.Noir,
      UltraHonkBackend: bbModule.UltraHonkBackend,
      Fr: bbModule.Fr,
      BarretenbergSync: bbModule.BarretenbergSync,
    };

    logWorker("init", "Module initialization complete");
    return moduleCache;
  } catch (error) {
    logWorker("error", "Module import failed", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    throw error;
  }
}

/**
 * Get Barretenberg instance for Poseidon2 hashing
 */
async function getBarretenberg() {
  if (bbInstance) return bbInstance;
  const { BarretenbergSync } = await getModules();
  const { canUseThreads, sharedArrayBuffer, crossOriginIsolated } =
    getIsolationSupport();
  if (!canUseThreads && !loggedIsolationFallback) {
    loggedIsolationFallback = true;
    logWorker(
      "init",
      "SharedArrayBuffer unavailable; using single-threaded WASM",
      {
        sharedArrayBuffer,
        crossOriginIsolated,
      },
    );
  }
  bbInstance = await BarretenbergSync.initSingleton(BB_WASM_PATH, bbLogger);
  return bbInstance;
}

function getCircuitArtifact(circuit: CircuitName) {
  switch (circuit) {
    case "age_verification":
      return ageCircuit as never;
    case "doc_validity":
      return docValidityCircuit as never;
    case "face_match":
      return faceMatchCircuit as never;
    case "nationality_membership":
      return nationalityCircuit as never;
  }
}

async function getNoirInstance(circuit: CircuitName) {
  const existing = noirInstanceCache.get(circuit);
  if (existing) return existing;
  const { Noir } = await getModules();
  const noir = new Noir(getCircuitArtifact(circuit));
  noirInstanceCache.set(circuit, noir);
  return noir;
}

async function getProverBackend(circuit: CircuitName) {
  const existing = proverBackendCache.get(circuit);
  if (existing) return existing;
  const { UltraHonkBackend } = await getModules();
  const { canUseThreads, sharedArrayBuffer, crossOriginIsolated } =
    getIsolationSupport();
  if (!canUseThreads && !loggedIsolationFallback) {
    loggedIsolationFallback = true;
    logWorker(
      "init",
      "SharedArrayBuffer unavailable; using single-threaded proving",
      {
        sharedArrayBuffer,
        crossOriginIsolated,
      },
    );
  }
  const threads = getThreadCount();
  const artifact = getCircuitArtifact(circuit) as { bytecode: string };
  const backend = new UltraHonkBackend(artifact.bytecode, {
    threads,
    logger: bbLogger,
    wasmPath: BB_WASM_PATH,
  });
  proverBackendCache.set(circuit, backend);
  return backend;
}

/**
 * Compute Poseidon2 hash of values (matches nodash::poseidon2)
 */
async function poseidon2Hash(values: bigint[]): Promise<bigint> {
  const bb = await getBarretenberg();
  const { Fr } = await getModules();
  const frValues = values.map((v) => new Fr(v));
  const result = bb.poseidon2Hash(frValues);
  return BigInt(result.toString());
}

/**
 * Compute Merkle path for nationality proof (CLIENT-SIDE)
 * Nationality code NEVER leaves this worker.
 */
async function computeMerklePath(
  nationalityCode: string,
  groupName: string,
): Promise<{
  nationalityCodeNumeric: number;
  merkleRoot: string;
  pathElements: string[];
  pathIndices: number[];
}> {
  const upperCode = nationalityCode.toUpperCase();
  const upperGroup = groupName.toUpperCase();

  const numericCode = COUNTRY_CODES[upperCode];
  if (numericCode === undefined) {
    throw new Error(`Unknown nationality code: ${nationalityCode}`);
  }

  const countries = COUNTRY_GROUPS[upperGroup];
  if (!countries) {
    throw new Error(`Unknown country group: ${groupName}`);
  }

  if (!countries.includes(upperCode)) {
    throw new Error(`${nationalityCode} is not a member of ${groupName}`);
  }

  // Get numeric codes for all countries in group
  const codes = countries.map((c) => COUNTRY_CODES[c]);

  // Pad to power of 2 size (2^TREE_DEPTH = 256)
  const treeSize = 2 ** TREE_DEPTH;
  const paddedCodes = [...codes];
  while (paddedCodes.length < treeSize) {
    paddedCodes.push(0);
  }

  // Build all levels of the Merkle tree
  const levels: bigint[][] = [];

  // Level 0: leaf hashes
  const leaves: bigint[] = [];
  let leafIndex = -1;
  for (let i = 0; i < paddedCodes.length; i++) {
    const code = paddedCodes[i];
    const leafHash = await poseidon2Hash([BigInt(code)]);
    leaves.push(leafHash);
    if (code === numericCode) {
      leafIndex = i;
    }
  }
  levels.push(leaves);

  if (leafIndex === -1) {
    throw new Error(`Country code ${numericCode} not found in tree`);
  }

  // Build higher levels
  let currentLevel = leaves;
  while (currentLevel.length > 1) {
    const nextLevel: bigint[] = [];
    for (let i = 0; i < currentLevel.length; i += 2) {
      const left = currentLevel[i];
      const right = currentLevel[i + 1];
      const parent = await poseidon2Hash([left, right]);
      nextLevel.push(parent);
    }
    levels.push(nextLevel);
    currentLevel = nextLevel;
  }

  // Extract path elements and indices
  const pathElements: bigint[] = [];
  const pathIndices: number[] = [];

  let idx = leafIndex;
  for (let level = 0; level < TREE_DEPTH; level++) {
    const isRight = idx % 2 === 1;
    const siblingIdx = isRight ? idx - 1 : idx + 1;
    pathElements.push(levels[level][siblingIdx]);
    pathIndices.push(isRight ? 1 : 0);
    idx = Math.floor(idx / 2);
  }

  const merkleRoot = levels[levels.length - 1][0];

  return {
    nationalityCodeNumeric: numericCode,
    merkleRoot: `0x${merkleRoot.toString(16)}`,
    pathElements: pathElements.map((e) => `0x${e.toString(16)}`),
    pathIndices,
  };
}

/**
 * Convert hex nonce to Field-compatible format
 * Noir expects Field values as decimal strings or hex with 0x prefix
 */
function nonceToField(nonce: string): string {
  // If already has 0x prefix, use as-is
  if (nonce.startsWith("0x")) {
    return nonce;
  }
  // Otherwise prepend 0x
  return `0x${nonce}`;
}

/**
 * Generate an age verification proof
 */
async function generateAgeProof(
  payload: AgeProofPayload,
): Promise<{ proof: number[]; publicInputs: string[] }> {
  const noir = await getNoirInstance("age_verification");
  logWorker("proof", "Executing age witness");
  const { witness } = await noir.execute({
    birth_year: payload.birthYear.toString(),
    current_year: payload.currentYear.toString(),
    min_age: payload.minAge.toString(),
    nonce: nonceToField(payload.nonce),
  });
  logWorker("proof", "Age witness ready", { size: witness.length });

  const backend = await getProverBackend("age_verification");
  logWorker("proof", "Generating age proof");
  const proof = await backend.generateProof(witness);
  logWorker("proof", "Age proof generated", {
    proofSize: proof.proof.length,
    publicInputs: proof.publicInputs.length,
  });

  // Convert Uint8Array to regular array for transfer
  return {
    proof: Array.from(proof.proof),
    publicInputs: proof.publicInputs,
  };
}

/**
 * Generate a document validity proof
 */
async function generateDocValidityProof(
  payload: DocValidityPayload,
): Promise<{ proof: number[]; publicInputs: string[] }> {
  const noir = await getNoirInstance("doc_validity");
  logWorker("proof", "Executing doc validity witness");
  const { witness } = await noir.execute({
    expiry_date: payload.expiryDate.toString(),
    current_date: payload.currentDate.toString(),
    nonce: nonceToField(payload.nonce),
  });
  logWorker("proof", "Doc validity witness ready", { size: witness.length });

  const backend = await getProverBackend("doc_validity");
  logWorker("proof", "Generating doc validity proof");
  const proof = await backend.generateProof(witness);
  logWorker("proof", "Doc validity proof generated", {
    proofSize: proof.proof.length,
    publicInputs: proof.publicInputs.length,
  });

  return {
    proof: Array.from(proof.proof),
    publicInputs: proof.publicInputs,
  };
}

async function generateFaceMatchProof(
  payload: FaceMatchPayload,
): Promise<{ proof: number[]; publicInputs: string[] }> {
  const noir = await getNoirInstance("face_match");
  logWorker("proof", "Executing face match witness");
  const { witness } = await noir.execute({
    similarity_score: payload.similarityScore.toString(),
    threshold: payload.threshold.toString(),
    nonce: nonceToField(payload.nonce),
  });
  logWorker("proof", "Face match witness ready", { size: witness.length });

  const backend = await getProverBackend("face_match");
  logWorker("proof", "Generating face match proof");
  const proof = await backend.generateProof(witness);
  logWorker("proof", "Face match proof generated", {
    proofSize: proof.proof.length,
    publicInputs: proof.publicInputs.length,
  });

  return {
    proof: Array.from(proof.proof),
    publicInputs: proof.publicInputs,
  };
}

/**
 * Generate a nationality membership proof (with pre-computed Merkle path)
 */
async function generateNationalityProof(
  payload: NationalityProofPayload,
): Promise<{ proof: number[]; publicInputs: string[] }> {
  const noir = await getNoirInstance("nationality_membership");
  logWorker("proof", "Executing nationality witness");
  const { witness } = await noir.execute({
    nationality_code: payload.nationalityCode.toString(),
    merkle_root: payload.merkleRoot,
    path_elements: payload.pathElements,
    path_indices: payload.pathIndices,
    nonce: nonceToField(payload.nonce),
  });
  logWorker("proof", "Nationality witness ready", { size: witness.length });

  const backend = await getProverBackend("nationality_membership");
  logWorker("proof", "Generating nationality proof");
  const proof = await backend.generateProof(witness);
  logWorker("proof", "Nationality proof generated", {
    proofSize: proof.proof.length,
    publicInputs: proof.publicInputs.length,
  });

  return {
    proof: Array.from(proof.proof),
    publicInputs: proof.publicInputs,
  };
}

/**
 * Generate nationality proof with CLIENT-SIDE Merkle path computation
 * Nationality NEVER leaves this worker - only the ZK proof is returned.
 */
async function generateNationalityProofClient(
  payload: NationalityClientPayload,
): Promise<{ proof: number[]; publicInputs: string[] }> {
  // Compute Merkle path locally - nationality stays in worker
  const merkleData = await computeMerklePath(
    payload.nationalityCode,
    payload.groupName,
  );

  // Generate proof with computed Merkle data
  return generateNationalityProof({
    nationalityCode: merkleData.nationalityCodeNumeric,
    merkleRoot: merkleData.merkleRoot,
    pathElements: merkleData.pathElements,
    pathIndices: merkleData.pathIndices,
    nonce: payload.nonce,
  });
}

/**
 * Handle incoming messages from the main thread
 */
self.onmessage = async (
  event: MessageEvent<WorkerRequest | WorkerInitMessage>,
) => {
  const request = event.data;

  if (
    typeof request === "object" &&
    request &&
    "type" in request &&
    request.type === "init" &&
    "origin" in request
  ) {
    const origin = typeof request.origin === "string" ? request.origin : null;
    setFetchOrigin(origin);
    logWorker("init", "Fetch origin set", { origin });
    return;
  }

  // Handle health check outside of queue for immediate response
  if (request.type === "health_check") {
    logWorker("health", "Health check received, initializing modules...");
    try {
      await getModules();
      logWorker("health", "Health check passed - modules loaded");
      self.postMessage({
        id: request.id,
        success: true,
        result: { healthy: true },
      });
    } catch (error) {
      logWorker("health", "Health check failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      self.postMessage({
        id: request.id,
        success: false,
        error: error instanceof Error ? error.message : "Health check failed",
      });
    }
    return;
  }

  workerQueue = workerQueue
    .then(async () => {
      const { id, type, payload } = request;
      logWorker("proof", `Starting ${type} proof generation`, { id });
      const proofStart = performance.now();

      try {
        let result: { proof: number[]; publicInputs: string[] };

        if (type === "age") {
          result = await generateAgeProof(payload as AgeProofPayload);
        } else if (type === "doc_validity") {
          result = await generateDocValidityProof(
            payload as DocValidityPayload,
          );
        } else if (type === "face_match") {
          result = await generateFaceMatchProof(payload as FaceMatchPayload);
        } else if (type === "nationality") {
          result = await generateNationalityProof(
            payload as NationalityProofPayload,
          );
        } else if (type === "nationality_client") {
          // Client-side Merkle computation - nationality NEVER leaves worker
          result = await generateNationalityProofClient(
            payload as NationalityClientPayload,
          );
        } else {
          throw new Error(`Unknown proof type: ${type}`);
        }

        const durationMs = Math.round(performance.now() - proofStart);
        logWorker("proof", `${type} proof generated`, { id, durationMs });

        const response: WorkerResponse = {
          id,
          success: true,
          result,
        };
        self.postMessage(response);
      } catch (error) {
        const durationMs = Math.round(performance.now() - proofStart);
        logWorker("error", `${type} proof generation failed`, {
          id,
          durationMs,
          error: error instanceof Error ? error.message : String(error),
        });

        const response: WorkerResponse = {
          id,
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        };
        self.postMessage(response);
      }
    })
    .catch(() => {
      // Keep the queue alive even if a previous request failed.
    });
};

// Log worker initialization
logWorker("init", "Worker script loaded", {
  crossOriginIsolated: globalThis.crossOriginIsolated ?? false,
  sharedArrayBuffer: typeof SharedArrayBuffer !== "undefined",
  hardwareConcurrency: self.navigator?.hardwareConcurrency ?? null,
});
