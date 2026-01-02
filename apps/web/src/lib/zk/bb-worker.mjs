import { createHash } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { createInterface } from "node:readline";

import { UltraHonkBackend } from "@aztec/bb.js";

/** Matches decimal numbers only */
const DECIMAL_NUMBER_PATTERN = /^[0-9]+$/;
/** Matches hexadecimal characters */
const HEX_CHARS_PATTERN = /^[0-9a-fA-F]+$/;

function sha256Hex(input) {
  return createHash("sha256").update(input).digest("hex");
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
const crsPath =
  process.env.BB_CRS_PATH || process.env.CRS_PATH || "/tmp/.bb-crs";

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

  const backend = new UltraHonkBackend(bytecode, {
    threads: 1,
    crsPath,
  });

  backendCache.set(cacheKey, backend);
  return backend;
}

async function getVerificationKeyResult(circuitType, bytecode) {
  const cacheKey = getCacheKey(circuitType, bytecode);
  const cached = vkeyCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const backend = await getBackend(circuitType, bytecode);
  const vkBytes = await backend.getVerificationKey();
  const vkHash = sha256Hex(vkBytes);
  const result = {
    verificationKey: Buffer.from(vkBytes).toString("base64"),
    verificationKeyHash: vkHash,
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
    const backend = await getBackend(params.circuitType, params.bytecode);
    const proofBytes = Buffer.from(params.proof, "base64");
    const publicInputs = (params.publicInputs || []).map(normalizePublicInput);
    const isValid = await backend.verifyProof({
      proof: new Uint8Array(proofBytes),
      publicInputs,
    });
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
