import { createHash } from "node:crypto";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { cpus } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";

import { UltraHonkBackend, UltraHonkVerifierBackend } from "@aztec/bb.js";
import { poseidon2HashAsync } from "@zkpassport/poseidon2";

/** Matches decimal numbers only */
const DECIMAL_NUMBER_PATTERN = /^[0-9]+$/;
/** Matches hexadecimal characters */
const HEX_CHARS_PATTERN = /^[0-9a-fA-F]+$/;

function sha256Hex(input) {
  return createHash("sha256").update(input).digest("hex");
}

function toFieldHex(bytes) {
  return Buffer.from(bytes).toString("hex").padStart(64, "0");
}

function vkBytesToFields(vkBytes) {
  const fields = [];
  for (let offset = 0; offset < vkBytes.length; offset += 32) {
    const chunk = vkBytes.slice(offset, offset + 32);
    fields.push(BigInt(`0x${toFieldHex(chunk)}`));
  }
  return fields;
}

function getPublicInputCountFromVkey(vkBytes) {
  if (vkBytes.length < 64) {
    throw new Error("Verification key too small to parse public input count");
  }
  const countHex = toFieldHex(vkBytes.slice(32, 64));
  const count = BigInt(`0x${countHex}`) - 16n;
  if (count < 0n) {
    throw new Error("Invalid public input count in verification key");
  }
  const asNumber = Number(count);
  if (!Number.isSafeInteger(asNumber)) {
    throw new Error("Public input count exceeds safe integer range");
  }
  return asNumber;
}

function normalizePublicInput(input) {
  const trimmed = String(input).trim();
  if (!trimmed) {
    return trimmed;
  }
  if (trimmed.startsWith("0x") || trimmed.startsWith("0X")) {
    return trimmed;
  }
  if (DECIMAL_NUMBER_PATTERN.test(trimmed)) {
    return trimmed;
  }
  if (HEX_CHARS_PATTERN.test(trimmed)) {
    return `0x${trimmed}`;
  }
  return trimmed;
}

const backendCache = new Map();
const vkeyCache = new Map();
let verifierBackend = null;
let verifierBackendPromise = null;
const crsPath =
  process.env.BB_CRS_PATH || process.env.CRS_PATH || "/tmp/.bb-crs";

const CRS_FILES = [
  "bn254_g1.dat",
  "bn254_g1.dat.gz",
  "g1.dat",
  "g1.dat.gz",
  "bn254_g2.dat",
];

if (!process.env.CRS_PATH) {
  process.env.CRS_PATH = crsPath;
}

try {
  mkdirSync(crsPath, { recursive: true });
} catch {
  // Best-effort: directory might already exist or be read-only.
}

function logError(prefix, error) {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : null;
  if (stack) {
    process.stderr.write(`${prefix}: ${message}\n${stack}\n`);
  } else {
    process.stderr.write(`${prefix}: ${message}\n`);
  }
}

function isInvalidCrsError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("invalid g1_identity") ||
    message.includes("MemBn254CrsFactory")
  );
}

function clearCrsCache(reason) {
  for (const file of CRS_FILES) {
    try {
      rmSync(path.join(crsPath, file), { force: true });
    } catch {
      // Best effort cleanup.
    }
  }
  backendCache.clear();
  vkeyCache.clear();
  verifierBackend = null;
  verifierBackendPromise = null;
  process.stderr.write(
    `[bb-worker] Cleared CRS cache at ${crsPath} (${reason})\n`
  );
}

function getCacheKey(circuitType, bytecode) {
  return `${circuitType}:${sha256Hex(bytecode)}`;
}

function getBackend(circuitType, bytecode) {
  if (typeof circuitType !== "string" || !circuitType) {
    throw new Error("circuitType is required");
  }

  if (typeof bytecode !== "string" || !bytecode) {
    throw new Error("bytecode is required");
  }

  const cacheKey = getCacheKey(circuitType, bytecode);
  const cached = backendCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const crsExists =
    existsSync(`${crsPath}/bn254_g1.dat`) ||
    existsSync(`${crsPath}/bn254_g1.dat.gz`) ||
    existsSync(`${crsPath}/g1.dat`) ||
    existsSync(`${crsPath}/g1.dat.gz`);

  if (!crsExists) {
    process.stderr.write(
      `bb-worker: CRS cache not found at ${crsPath}. Will attempt download.\n`
    );
  }

  const parsedThreads = Number.parseInt(process.env.BB_THREADS || "", 10);
  const cpuCount = Math.max(1, cpus()?.length ?? 1);
  const defaultThreads = Math.max(2, Math.min(4, cpuCount));
  const threads =
    Number.isFinite(parsedThreads) && parsedThreads > 0
      ? parsedThreads
      : defaultThreads;

  const backend = new UltraHonkBackend(bytecode, {
    threads,
    crsPath,
  });

  backendCache.set(cacheKey, backend);
  return backend;
}

async function getVerifierBackend() {
  if (verifierBackend) {
    return verifierBackend;
  }
  if (!verifierBackendPromise) {
    const parsedThreads = Number.parseInt(process.env.BB_THREADS || "", 10);
    const cpuCount = Math.max(1, cpus()?.length ?? 1);
    const defaultThreads = Math.max(2, Math.min(4, cpuCount));
    const threads =
      Number.isFinite(parsedThreads) && parsedThreads > 0
        ? parsedThreads
        : defaultThreads;

    verifierBackendPromise = Promise.resolve(
      new UltraHonkVerifierBackend({
        threads,
        crsPath,
      })
    );
  }
  verifierBackend = await verifierBackendPromise;
  return verifierBackend;
}

async function getVerificationKeyResult(circuitType, bytecode) {
  const cacheKey = getCacheKey(circuitType, bytecode);
  const cached = vkeyCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  let backend = await getBackend(circuitType, bytecode);
  let vkBytes;
  try {
    vkBytes = await backend.getVerificationKey();
  } catch (error) {
    if (!isInvalidCrsError(error)) {
      throw error;
    }
    clearCrsCache("invalid CRS identity");
    backend = await getBackend(circuitType, bytecode);
    vkBytes = await backend.getVerificationKey();
  }
  const vkHash = sha256Hex(vkBytes);
  const vkeyPoseidonHash = await poseidon2HashAsync(vkBytesToFields(vkBytes));
  const publicInputCount = getPublicInputCountFromVkey(vkBytes);
  const result = {
    verificationKey: Buffer.from(vkBytes).toString("base64"),
    verificationKeyHash: vkHash,
    verificationKeyPoseidonHash: `0x${vkeyPoseidonHash.toString(16).padStart(64, "0")}`,
    publicInputCount,
    size: vkBytes.length,
  };
  vkeyCache.set(cacheKey, result);
  return result;
}

async function handle(method, params) {
  if (method === "getVerificationKey") {
    return await getVerificationKeyResult(params.circuitType, params.bytecode);
  }

  if (method === "verifyProof") {
    const start = Date.now();
    const proofBytes = Buffer.from(params.proof, "base64");
    const publicInputs = (params.publicInputs || []).map(normalizePublicInput);
    const vkResult = await getVerificationKeyResult(
      params.circuitType,
      params.bytecode
    );
    if (publicInputs.length !== vkResult.publicInputCount) {
      return {
        isValid: false,
        verificationTimeMs: Date.now() - start,
        reason: `Public input length mismatch (expected ${vkResult.publicInputCount}, got ${publicInputs.length})`,
      };
    }
    let isValid;
    try {
      const verifier = await getVerifierBackend();
      isValid = await verifier.verifyProof({
        proof: new Uint8Array(proofBytes),
        publicInputs,
        verificationKey: Buffer.from(vkResult.verificationKey, "base64"),
      });
    } catch (error) {
      if (!isInvalidCrsError(error)) {
        throw error;
      }
      clearCrsCache("invalid CRS identity");
      const verifier = await getVerifierBackend();
      isValid = await verifier.verifyProof({
        proof: new Uint8Array(proofBytes),
        publicInputs,
        verificationKey: Buffer.from(vkResult.verificationKey, "base64"),
      });
    }
    return {
      isValid,
      verificationTimeMs: Date.now() - start,
    };
  }

  throw new Error(`Unknown method: ${method}`);
}

const rl = createInterface({
  input: process.stdin,
  crlfDelay: Number.POSITIVE_INFINITY,
});
rl.on("line", (line) => {
  if (!line.trim()) {
    return;
  }
  let msg;
  try {
    msg = JSON.parse(line);
  } catch (error) {
    process.stdout.write(
      `${JSON.stringify({
        id: null,
        error: {
          message: `Invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
        },
      })}\n`
    );
    return;
  }

  const id = msg?.id;
  const method = msg?.method;
  const params = msg?.params;

  Promise.resolve()
    .then(async () => {
      const result = await handle(method, params);
      process.stdout.write(`${JSON.stringify({ id, result })}\n`);
    })
    .catch((error) => {
      logError("bb-worker request failed", error);
      process.stdout.write(
        `${JSON.stringify({
          id,
          error: {
            message: error instanceof Error ? error.message : String(error),
          },
        })}\n`
      );
    });
});

rl.on("close", () => {
  process.exit(0);
});
