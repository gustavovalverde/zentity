/**
 * Noir Prover Web Worker
 *
 * Runs proof generation off the main thread to keep the UI responsive.
 * Dynamically imports Noir.js and bb.js when first proof is requested.
 *
 * PRIVACY: All sensitive data (birth year, nationality) stays in this worker.
 * Only cryptographic proofs are returned to the main thread.
 */

// Buffer polyfill for browser environment
// bb.js requires Buffer with BigInt methods (writeBigUInt64BE, etc.)
import { Buffer } from "buffer";

globalThis.Buffer = Buffer;

import type { InitInput as AcvmInitInput } from "@noir-lang/acvm_js";
import type { InitInput as NoirAbiInitInput } from "@noir-lang/noirc_abi";
import type {
  AgeProofPayload,
  DocValidityPayload,
  FaceMatchPayload,
  IdentityBindingPayload,
  NationalityClientPayload,
  NationalityProofPayload,
  WorkerInitMessage,
  WorkerRequest,
  WorkerResponse,
} from "./noir-worker-manager";

import { getCountryWeightedSum } from "@zkpassport/utils";

import { COUNTRY_GROUPS, TREE_DEPTH } from "@/lib/privacy/country";
import ageCircuit from "@/noir-circuits/age_verification/artifacts/age_verification.json";
import docValidityCircuit from "@/noir-circuits/doc_validity/artifacts/doc_validity.json";
import faceMatchCircuit from "@/noir-circuits/face_match/artifacts/face_match.json";
import identityBindingCircuit from "@/noir-circuits/identity_binding/artifacts/identity_binding.json";
import nationalityCircuit from "@/noir-circuits/nationality_membership/artifacts/nationality_membership.json";

const ENABLE_WORKER_LOGS =
  process.env.NEXT_PUBLIC_NOIR_DEBUG === "true" &&
  (process.env.NODE_ENV === "development" ||
    process.env.NEXT_PUBLIC_APP_ENV === "local");

function logWorker(
  stage: string,
  msg: string,
  data?: Record<string, unknown>
): void {
  if (!ENABLE_WORKER_LOGS) {
    return;
  }
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
  Barretenberg: typeof import("@aztec/bb.js").Barretenberg;
  UltraHonkBackend: typeof import("@aztec/bb.js").UltraHonkBackend;
  BN254_FR_MODULUS: bigint;
  initACVM: (input?: NoirWasmInitInput) => Promise<unknown>;
  initNoirC: (input?: NoirWasmInitInput) => Promise<unknown>;
}

let moduleCache: ModuleCache | null = null;
let bbApiPromise: Promise<import("@aztec/bb.js").Barretenberg> | null = null;
let noirRuntimeInitPromise: Promise<void> | null = null;

type CircuitName =
  | "age_verification"
  | "doc_validity"
  | "face_match"
  | "identity_binding"
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

let loggedIsolationFallback = false;
let cleanupTimer: ReturnType<typeof setTimeout> | null = null;
let activeProofs = 0;

type NoirWasmInitInput =
  | AcvmInitInput
  | NoirAbiInitInput
  | Promise<AcvmInitInput | NoirAbiInitInput>
  | {
      module_or_path:
        | AcvmInitInput
        | NoirAbiInitInput
        | Promise<AcvmInitInput | NoirAbiInitInput>;
    };

/**
 * Local path for bb.js WASM (copied by setup-coep-assets.ts).
 * Serving locally avoids CDN latency and improves reliability.
 */
const BB_WASM_PATH = "/bb/barretenberg.wasm.gz";
const NOIR_WASM_BASE_PATH = "/noir";
const IDLE_CLEANUP_MS = Number.parseInt(
  process.env.NEXT_PUBLIC_NOIR_IDLE_CLEANUP_MS ?? "300000",
  10
);
const ENABLE_IDLE_CLEANUP =
  Number.isFinite(IDLE_CLEANUP_MS) && IDLE_CLEANUP_MS > 0;

function getIsolationSupport() {
  const sharedArrayBuffer = typeof SharedArrayBuffer !== "undefined";
  const crossOriginIsolated = globalThis.crossOriginIsolated === true;
  return {
    sharedArrayBuffer,
    crossOriginIsolated,
    canUseThreads: sharedArrayBuffer && crossOriginIsolated,
  };
}

// Some bundlers load module workers via `blob:` URLs. In that case, `fetch("/...")`
// fails because the base URL is non-hierarchical. Normalize absolute-path fetches
// to an origin-qualified URL when possible.
let fetchOrigin: string | null = null;
const originalFetch =
  typeof globalThis.fetch === "function" ? globalThis.fetch : null;

function setFetchOrigin(origin: string | null) {
  if (!(originalFetch && origin) || origin === "null") {
    return;
  }
  if (fetchOrigin === origin) {
    return;
  }
  fetchOrigin = origin;

  const originalFetchBound = originalFetch.bind(globalThis);
  const CRS_CDN = "https://crs.aztec.network/";
  const wrappedFetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    // Serve CRS from pre-warmed local files instead of CDN
    if (typeof input === "string" && input.startsWith(CRS_CDN)) {
      return originalFetchBound(
        `${origin}/api/bb-crs/${input.slice(CRS_CDN.length)}`,
        init
      );
    }
    // Fix absolute paths for blob: URL workers
    if (typeof input === "string" && input.startsWith("/")) {
      return originalFetchBound(`${origin}${input}`, init);
    }
    if (input instanceof URL && input.pathname.startsWith("/")) {
      return originalFetchBound(
        new URL(`${origin}${input.pathname}${input.search}`),
        init
      );
    }
    return originalFetchBound(input, init);
  }) as typeof fetch;

  // Copy any non-standard fetch properties (e.g., Bun's preconnect)
  if ("preconnect" in originalFetch) {
    (wrappedFetch as unknown as Record<string, unknown>).preconnect = (
      originalFetch as unknown as Record<string, unknown>
    ).preconnect;
  }

  globalThis.fetch = wrappedFetch;
}

function getNoirWasmUrl(filename: string): URL | null {
  const origin =
    fetchOrigin ??
    (typeof self.location?.origin === "string" ? self.location.origin : null);
  if (!origin || origin === "null") {
    return null;
  }
  return new URL(`${NOIR_WASM_BASE_PATH}/${filename}`, origin);
}

async function fetchNoirWasmInitInput(url: URL): Promise<NoirWasmInitInput> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Failed to load Noir WASM (${response.status} ${response.statusText})`
    );
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/wasm")) {
    return response;
  }
  return await response.arrayBuffer();
}

function cancelIdleCleanup() {
  if (cleanupTimer) {
    clearTimeout(cleanupTimer);
    cleanupTimer = null;
  }
}

function scheduleIdleCleanup() {
  if (!ENABLE_IDLE_CLEANUP) {
    return;
  }
  cancelIdleCleanup();
  cleanupTimer = setTimeout(() => {
    try {
      cleanupProverBackends("idle");
    } catch (error) {
      logWorker("cleanup", "Idle cleanup failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, IDLE_CLEANUP_MS);
}

function cleanupProverBackends(reason: string) {
  if (activeProofs > 0) {
    scheduleIdleCleanup();
    return;
  }
  const backends = Array.from(proverBackendCache.entries());
  if (!backends.length) {
    return;
  }
  logWorker("cleanup", "Destroying cached prover backends", {
    count: backends.length,
    reason,
  });
  proverBackendCache.clear();
  logWorker("cleanup", "Prover backends cleared", {
    count: backends.length,
  });
}

if (originalFetch) {
  try {
    const origin = new URL(globalThis.location.href).origin;
    setFetchOrigin(origin);
  } catch {
    // Origin will be injected from main thread when running under blob: URLs.
  }
}

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

    const initACVM =
      typeof noirModule.acvm?.default === "function"
        ? noirModule.acvm.default
        : (await import("@noir-lang/acvm_js")).default;
    const initNoirC =
      typeof noirModule.abi?.default === "function"
        ? noirModule.abi.default
        : (await import("@noir-lang/noirc_abi")).default;

    moduleCache = {
      Noir: noirModule.Noir,
      Barretenberg: bbModule.Barretenberg,
      UltraHonkBackend: bbModule.UltraHonkBackend,
      BN254_FR_MODULUS: bbModule.BN254_FR_MODULUS,
      initACVM,
      initNoirC,
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

function ensureNoirRuntimeReady(): Promise<void> {
  if (noirRuntimeInitPromise) {
    return noirRuntimeInitPromise;
  }

  noirRuntimeInitPromise = (async () => {
    const { initACVM, initNoirC } = await getModules();
    const acvmWasm = getNoirWasmUrl("acvm_js_bg.wasm");
    const noircWasm = getNoirWasmUrl("noirc_abi_wasm_bg.wasm");

    logWorker("init", "Initializing Noir WASM runtime", {
      acvmWasm: acvmWasm ? String(acvmWasm) : "module-default",
      noircWasm: noircWasm ? String(noircWasm) : "module-default",
    });

    let initialized = false;
    if (acvmWasm && noircWasm) {
      try {
        const [acvmInput, noircInput] = await Promise.all([
          fetchNoirWasmInitInput(acvmWasm),
          fetchNoirWasmInitInput(noircWasm),
        ]);
        await Promise.all([
          initACVM({ module_or_path: acvmInput }),
          initNoirC({ module_or_path: noircInput }),
        ]);
        initialized = true;
      } catch (error) {
        logWorker("init", "Noir WASM init failed; falling back to defaults", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (!initialized) {
      await Promise.all([initACVM(), initNoirC()]);
    }

    logWorker("init", "Noir WASM runtime ready");
  })();

  noirRuntimeInitPromise.catch(() => {
    noirRuntimeInitPromise = null;
  });

  return noirRuntimeInitPromise;
}

async function getBarretenbergApi(): Promise<
  import("@aztec/bb.js").Barretenberg
> {
  if (bbApiPromise) {
    return bbApiPromise;
  }

  const { Barretenberg } = await getModules();
  const { canUseThreads, sharedArrayBuffer, crossOriginIsolated } =
    getIsolationSupport();

  if (!(canUseThreads || loggedIsolationFallback)) {
    loggedIsolationFallback = true;
    logWorker(
      "init",
      "SharedArrayBuffer unavailable; using single-threaded WASM",
      {
        sharedArrayBuffer,
        crossOriginIsolated,
      }
    );
  }

  bbApiPromise = Barretenberg.new({
    wasmPath: BB_WASM_PATH,
  });

  return bbApiPromise;
}

/**
 * Convert a bigint to a 32-byte big-endian Uint8Array (Fr field element)
 */
function bigIntToFr(value: bigint, modulus: bigint): Uint8Array {
  const reduced = value % modulus;
  const hex = reduced.toString(16).padStart(64, "0");
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Poseidon2 hash using Barretenberg API
 */
async function poseidon2Hash(values: bigint[]): Promise<bigint> {
  const api = await getBarretenbergApi();
  const { BN254_FR_MODULUS } = await getModules();
  const frValues = values.map((v) => bigIntToFr(v, BN254_FR_MODULUS));
  const result = await api.poseidon2Hash({ inputs: frValues });
  const hex = Array.from(result.hash)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return BigInt(`0x${hex}`);
}

/**
 * Reduce a hex string to BN254 field element.
 * Values exceeding field modulus are reduced via modular arithmetic.
 */
async function reduceToField(hexValue: string): Promise<string> {
  const { BN254_FR_MODULUS } = await getModules();
  const bigIntValue = BigInt(hexValue);
  const reduced = bigIntValue % BN254_FR_MODULUS;
  return `0x${reduced.toString(16).padStart(64, "0")}`;
}

function getCircuitArtifact(circuit: CircuitName) {
  switch (circuit) {
    case "age_verification":
      return ageCircuit as never;
    case "doc_validity":
      return docValidityCircuit as never;
    case "face_match":
      return faceMatchCircuit as never;
    case "identity_binding":
      return identityBindingCircuit as never;
    case "nationality_membership":
      return nationalityCircuit as never;
    default: {
      const _exhaustive: never = circuit;
      throw new Error(`Unknown circuit: ${_exhaustive}`);
    }
  }
}

async function getNoirInstance(circuit: CircuitName) {
  const existing = noirInstanceCache.get(circuit);
  if (existing) {
    return existing;
  }
  await ensureNoirRuntimeReady();
  const { Noir } = await getModules();
  const noir = new Noir(getCircuitArtifact(circuit));
  noirInstanceCache.set(circuit, noir);
  return noir;
}

async function getProverBackend(circuit: CircuitName) {
  const existing = proverBackendCache.get(circuit);
  if (existing) {
    return existing;
  }
  const { UltraHonkBackend } = await getModules();
  const api = await getBarretenbergApi();
  const artifact = getCircuitArtifact(circuit) as { bytecode: string };
  const backend = new UltraHonkBackend(artifact.bytecode, api);
  proverBackendCache.set(circuit, backend);
  return backend;
}

interface MerkleCacheEntry {
  levels: bigint[][];
  indexByCode: Map<number, number>;
}

const merkleCache = new Map<string, Promise<MerkleCacheEntry>>();

async function buildMerkleCacheForGroup(
  groupName: string
): Promise<MerkleCacheEntry> {
  const upperGroup = groupName.toUpperCase();
  const countries = COUNTRY_GROUPS[upperGroup as keyof typeof COUNTRY_GROUPS];
  if (!countries) {
    throw new Error(`Unknown country group: ${groupName}`);
  }

  const codes = countries.map((c) =>
    getCountryWeightedSum(c as Parameters<typeof getCountryWeightedSum>[0])
  );
  const treeSize = 2 ** TREE_DEPTH;
  const paddedCodes = [...codes];
  while (paddedCodes.length < treeSize) {
    paddedCodes.push(0);
  }

  const levels: bigint[][] = [];
  const leaves: bigint[] = [];
  const indexByCode = new Map<number, number>();

  for (let i = 0; i < paddedCodes.length; i++) {
    const code = paddedCodes[i];
    const leafHash = await poseidon2Hash([BigInt(code)]);
    leaves.push(leafHash);
    if (code !== 0) {
      indexByCode.set(code, i);
    }
  }
  levels.push(leaves);

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

  return { levels, indexByCode };
}

function getMerkleCache(groupName: string): Promise<MerkleCacheEntry> {
  const upperGroup = groupName.toUpperCase();
  const cached = merkleCache.get(upperGroup);
  if (cached) {
    return cached;
  }
  const promise = buildMerkleCacheForGroup(upperGroup);
  merkleCache.set(upperGroup, promise);
  return promise;
}

/**
 * Compute Merkle path for nationality proof (CLIENT-SIDE)
 * Nationality code NEVER leaves this worker.
 */
async function computeMerklePath(
  nationalityCode: string,
  groupName: string
): Promise<{
  nationalityCodeNumeric: number;
  merkleRoot: string;
  pathElements: string[];
  pathIndices: number[];
}> {
  const upperCode = nationalityCode.toUpperCase();
  const upperGroup = groupName.toUpperCase();

  // Validate the code is in a known group before computing weighted sum
  const countries = COUNTRY_GROUPS[upperGroup as keyof typeof COUNTRY_GROUPS];
  if (!countries) {
    throw new Error(`Unknown country group: ${groupName}`);
  }
  if (!countries.some((c) => c === upperCode)) {
    throw new Error(`${nationalityCode} is not a member of ${groupName}`);
  }
  const numericCode = getCountryWeightedSum(
    upperCode as Parameters<typeof getCountryWeightedSum>[0]
  );

  const { levels, indexByCode } = await getMerkleCache(upperGroup);
  const leafIndex = indexByCode.get(numericCode);
  if (leafIndex === undefined) {
    throw new Error(`Country code ${numericCode} not found in tree`);
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

  const root = levels.at(-1);
  if (!root) {
    throw new Error("Invalid Merkle tree: no root level");
  }
  const merkleRoot = root[0];

  return {
    nationalityCodeNumeric: numericCode,
    merkleRoot: `0x${merkleRoot.toString(16)}`,
    pathElements: pathElements.map((e) => `0x${e.toString(16)}`),
    pathIndices,
  };
}

/**
 * Convert hex nonce to Field-compatible format
 */
function nonceToField(nonce: string): string {
  if (nonce.startsWith("0x")) {
    return nonce;
  }
  return `0x${nonce}`;
}

async function generateAgeProof(
  payload: AgeProofPayload
): Promise<{ proof: number[]; publicInputs: string[] }> {
  const noir = await getNoirInstance("age_verification");
  logWorker("proof", "Executing age witness");
  const { witness } = await noir.execute({
    dob_days: payload.dobDays.toString(),
    document_hash: payload.documentHashField,
    current_days: payload.currentDays.toString(),
    min_age_days: payload.minAgeDays.toString(),
    nonce: nonceToField(payload.nonce),
    claim_hash: payload.claimHash,
  });
  logWorker("proof", "Age witness ready", { size: witness.length });

  const backend = await getProverBackend("age_verification");
  logWorker("proof", "Generating age proof");
  const proof = await backend.generateProof(witness);
  logWorker("proof", "Age proof generated", {
    proofSize: proof.proof.length,
    publicInputs: proof.publicInputs.length,
  });

  return {
    proof: Array.from(proof.proof),
    publicInputs: proof.publicInputs,
  };
}

async function generateDocValidityProof(
  payload: DocValidityPayload
): Promise<{ proof: number[]; publicInputs: string[] }> {
  const noir = await getNoirInstance("doc_validity");
  logWorker("proof", "Executing doc validity witness");
  const { witness } = await noir.execute({
    expiry_date: payload.expiryDate.toString(),
    document_hash: payload.documentHashField,
    current_date: payload.currentDate.toString(),
    nonce: nonceToField(payload.nonce),
    claim_hash: payload.claimHash,
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
  payload: FaceMatchPayload
): Promise<{ proof: number[]; publicInputs: string[] }> {
  const noir = await getNoirInstance("face_match");
  logWorker("proof", "Executing face match witness");
  const { witness } = await noir.execute({
    similarity_score: payload.similarityScore.toString(),
    document_hash: payload.documentHashField,
    threshold: payload.threshold.toString(),
    nonce: nonceToField(payload.nonce),
    claim_hash: payload.claimHash,
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

async function generateNationalityProof(
  payload: NationalityProofPayload
): Promise<{ proof: number[]; publicInputs: string[] }> {
  const noir = await getNoirInstance("nationality_membership");
  logWorker("proof", "Executing nationality witness");
  const { witness } = await noir.execute({
    nationality_code: payload.nationalityCode.toString(),
    document_hash: payload.documentHashField,
    merkle_root: payload.merkleRoot,
    path_elements: payload.pathElements,
    path_indices: payload.pathIndices,
    nonce: nonceToField(payload.nonce),
    claim_hash: payload.claimHash,
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
  payload: NationalityClientPayload
): Promise<{ proof: number[]; publicInputs: string[] }> {
  const merkleData = await computeMerklePath(
    payload.nationalityCode,
    payload.groupName
  );

  return generateNationalityProof({
    nationalityCode: merkleData.nationalityCodeNumeric,
    merkleRoot: merkleData.merkleRoot,
    pathElements: merkleData.pathElements,
    pathIndices: merkleData.pathIndices,
    nonce: payload.nonce,
    documentHashField: payload.documentHashField,
    claimHash: payload.claimHash,
  });
}

/**
 * Generate an identity binding proof
 *
 * PRIVACY: The binding secret (derived from passkey PRF, OPAQUE export key,
 * or wallet signature) stays in this worker. Only the ZK proof is returned.
 */
async function generateIdentityBindingProof(
  payload: IdentityBindingPayload
): Promise<{ proof: number[]; publicInputs: string[] }> {
  const noir = await getNoirInstance("identity_binding");
  logWorker("proof", "Executing identity binding witness");

  // Reduce all field values to BN254 field (values may exceed modulus)
  const [bindingSecretReduced, userIdHashReduced, documentHashReduced] =
    await Promise.all([
      reduceToField(payload.bindingSecretField),
      reduceToField(payload.userIdHashField),
      reduceToField(payload.documentHashField),
    ]);

  logWorker("proof", "Reduced field values", {
    bindingSecret: `${bindingSecretReduced.slice(0, 20)}...`,
    userIdHash: `${userIdHashReduced.slice(0, 20)}...`,
    documentHash: `${documentHashReduced.slice(0, 20)}...`,
  });

  // Compute binding_commitment = Poseidon2(binding_secret, user_id_hash, document_hash)
  const bindingCommitment = await poseidon2Hash([
    BigInt(bindingSecretReduced),
    BigInt(userIdHashReduced),
    BigInt(documentHashReduced),
  ]);
  const bindingCommitmentHex = `0x${bindingCommitment.toString(16)}`;
  logWorker("proof", "Computed binding commitment", {
    bindingCommitmentHex,
  });

  const { witness } = await noir.execute({
    binding_secret: bindingSecretReduced,
    user_id_hash: userIdHashReduced,
    document_hash: documentHashReduced,
    nonce: nonceToField(payload.nonce),
    binding_commitment: bindingCommitmentHex,
  });
  logWorker("proof", "Identity binding witness ready", {
    size: witness.length,
  });

  const backend = await getProverBackend("identity_binding");
  logWorker("proof", "Generating identity binding proof");
  const proof = await backend.generateProof(witness);
  logWorker("proof", "Identity binding proof generated", {
    proofSize: proof.proof.length,
    publicInputs: proof.publicInputs.length,
  });

  return {
    proof: Array.from(proof.proof),
    publicInputs: proof.publicInputs,
  };
}

globalThis.onmessage = (
  event: MessageEvent<WorkerRequest | WorkerInitMessage>
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

  workerQueue = workerQueue
    .then(async () => {
      cancelIdleCleanup();
      activeProofs += 1;
      const { id, type, payload } = request;
      logWorker("proof", `Starting ${type} proof generation`, { id });
      const proofStart = performance.now();

      try {
        let result: { proof: number[]; publicInputs: string[] };

        if (type === "age") {
          result = await generateAgeProof(payload as AgeProofPayload);
        } else if (type === "doc_validity") {
          result = await generateDocValidityProof(
            payload as DocValidityPayload
          );
        } else if (type === "face_match") {
          result = await generateFaceMatchProof(payload as FaceMatchPayload);
        } else if (type === "nationality") {
          result = await generateNationalityProof(
            payload as NationalityProofPayload
          );
        } else if (type === "nationality_client") {
          result = await generateNationalityProofClient(
            payload as NationalityClientPayload
          );
        } else if (type === "identity_binding") {
          result = await generateIdentityBindingProof(
            payload as IdentityBindingPayload
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
      } finally {
        activeProofs = Math.max(0, activeProofs - 1);
        scheduleIdleCleanup();
      }
    })
    .catch(() => {
      // Keep the queue alive even if a previous request failed.
    });
};

logWorker("init", "Worker script loaded", {
  crossOriginIsolated: globalThis.crossOriginIsolated ?? false,
  sharedArrayBuffer: typeof SharedArrayBuffer !== "undefined",
  hardwareConcurrency: self.navigator?.hardwareConcurrency ?? null,
});
