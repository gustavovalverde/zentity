import crypto from "node:crypto";
import { writeFileSync } from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";

import {
  BackendType,
  Barretenberg,
  BN254_FR_MODULUS,
  UltraHonkBackend,
  UltraHonkVerifierBackend,
} from "@aztec/bb.js";
import { decode, encode } from "@msgpack/msgpack";
import { Noir } from "@noir-lang/noir_js";
import tfhe from "node-tfhe";

import {
  generateNationalityProofInputs,
  toNumericCode,
} from "@/lib/privacy/zk/country";
import ageCircuit from "@/noir-circuits/age_verification/artifacts/age_verification.json" with {
  type: "json",
};
import docValidityCircuit from "@/noir-circuits/doc_validity/artifacts/doc_validity.json" with {
  type: "json",
};
import faceMatchCircuit from "@/noir-circuits/face_match/artifacts/face_match.json" with {
  type: "json",
};
import identityBindingCircuit from "@/noir-circuits/identity_binding/artifacts/identity_binding.json" with {
  type: "json",
};
import nationalityCircuit from "@/noir-circuits/nationality_membership/artifacts/nationality_membership.json" with {
  type: "json",
};

type CircuitName =
  | "age_verification"
  | "doc_validity"
  | "nationality_membership"
  | "face_match"
  | "identity_binding";

interface ZkBenchmarkRow {
  circuit: CircuitName;
  proofBytesMedian: number;
  proveMsMedian: number;
  publicInputCount: number;
  runs: number;
  verifyMsMedian: number;
}

interface FheBenchmarkRow {
  latencyMsMedian: number;
  operation: "key_registration" | "encrypt_dob_days" | "verify_age_from_dob";
  runs: number;
}

interface BenchmarkOutput {
  fhe: FheBenchmarkRow[];
  meta: {
    timestamp: string;
    nodeVersion: string;
    platform: string;
    arch: string;
    runsZk: number;
    runsFhe: number;
  };
  zk: ZkBenchmarkRow[];
}

type Fr = Uint8Array;
type NoirArtifact = ConstructorParameters<typeof Noir>[0];
type NoirInputMap = Parameters<Noir["execute"]>[0];

interface FheRegisterKeyResponse {
  keyId: string;
}

interface FheEncryptBatchResponse {
  complianceLevelCiphertext?: Uint8Array | null;
  dobDaysCiphertext?: Uint8Array | null;
  livenessScoreCiphertext?: Uint8Array | null;
}

interface FheVerifyAgeResponse {
  resultCiphertext: Uint8Array;
}

const CRS_PATH = process.env.BB_CRS_PATH || "/tmp/.bb-crs";

const FHE_SERVICE_URL = (
  process.env.FHE_SERVICE_URL || "http://localhost:5001"
).replace(/\/+$/, "");

let bbPromise: Promise<Barretenberg> | null = null;
let verifierPromise: Promise<UltraHonkVerifierBackend> | null = null;

function getBarretenberg(): Promise<Barretenberg> {
  bbPromise ??= Barretenberg.new({
    backend: BackendType.Wasm,
    crsPath: CRS_PATH,
  });
  return bbPromise;
}

function getVerifierBackend(): Promise<UltraHonkVerifierBackend> {
  verifierPromise ??= (async () => {
    const bb = await getBarretenberg();
    return new UltraHonkVerifierBackend(bb);
  })();
  return verifierPromise;
}

function bigIntToFr(value: bigint): Fr {
  const reduced = value % BN254_FR_MODULUS;
  const hex = reduced.toString(16).padStart(64, "0");
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function frToHex(fr: Fr): string {
  const hex = Array.from(fr)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `0x${hex}`;
}

function frToBigInt(fr: Fr): bigint {
  return BigInt(frToHex(fr));
}

async function computeClaimHash(params: {
  value: number | bigint;
  documentHashField: string;
}): Promise<string> {
  const bb = await getBarretenberg();
  const valueBigInt =
    typeof params.value === "bigint" ? params.value : BigInt(params.value);
  const documentHashBigInt = BigInt(params.documentHashField);
  const result = await bb.poseidon2Hash({
    inputs: [bigIntToFr(valueBigInt), bigIntToFr(documentHashBigInt)],
  });
  return frToHex(result.hash);
}

async function poseidon2Hash(values: bigint[]): Promise<bigint> {
  const bb = await getBarretenberg();
  const result = await bb.poseidon2Hash({
    inputs: values.map(bigIntToFr),
  });
  return frToBigInt(result.hash);
}

function buildFheHeaders(
  extra: Record<string, string> = {}
): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/msgpack",
    "Content-Encoding": "gzip",
    Accept: "application/msgpack",
    "Accept-Encoding": "gzip",
    ...extra,
  };
  const token = process.env.INTERNAL_SERVICE_TOKEN;
  if (token) {
    headers["X-Zentity-Internal-Token"] = token;
  }
  return headers;
}

async function fetchFhe<T>(path: string, payload: unknown): Promise<T> {
  const url = `${FHE_SERVICE_URL}${path}`;
  const encoded = encode(payload);
  const compressed = gzipSync(encoded);

  const response = await fetch(url, {
    method: "POST",
    headers: buildFheHeaders(),
    body: compressed,
  });

  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    throw new Error(
      `FHE request failed: ${response.status} ${response.statusText} ${bodyText}`.trim()
    );
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const hasGzipMagic =
    buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b;
  const decodedBytes = hasGzipMagic ? gunzipSync(buffer) : buffer;
  return decode(decodedBytes) as T;
}

function parseArgs(argv: string[]) {
  const args = new Map<string, string | true>();
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i];
    if (!raw?.startsWith("--")) {
      continue;
    }
    const key = raw;
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args.set(key, true);
    } else {
      args.set(key, next);
      i++;
    }
  }
  return {
    out:
      (args.get("--out") as string | undefined) ??
      "docs/papers/zkproof8/benchmarks.json",
    runsZk: Number.parseInt(
      (args.get("--runs-zk") as string | undefined) ?? "10",
      10
    ),
    runsFhe: Number.parseInt(
      (args.get("--runs-fhe") as string | undefined) ?? "1",
      10
    ),
    skipFhe: Boolean(args.get("--skip-fhe")),
    onlyZk: Boolean(args.get("--only-zk")),
    onlyFhe: Boolean(args.get("--only-fhe")),
  };
}

function median(values: number[]): number {
  if (!values.length) {
    return Number.NaN;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
  }
  return sorted[mid] ?? 0;
}

function randomNonceFieldHex(): string {
  return `0x${crypto.randomBytes(16).toString("hex")}`;
}

function randomFieldHex(): string {
  const value =
    BigInt(`0x${crypto.randomBytes(32).toString("hex")}`) % BN254_FR_MODULUS;
  return `0x${value.toString(16).padStart(64, "0")}`;
}

async function initNoirRuntime(): Promise<void> {
  const acvmModule = await import("@noir-lang/acvm_js");
  const abiModule = await import("@noir-lang/noirc_abi");

  const maybeInitAcvm = (acvmModule as unknown as { default?: unknown })
    .default;
  const maybeInitAbi = (abiModule as unknown as { default?: unknown }).default;

  const tasks: Promise<unknown>[] = [];
  if (typeof maybeInitAcvm === "function") {
    tasks.push((maybeInitAcvm as () => Promise<unknown>)());
  }
  if (typeof maybeInitAbi === "function") {
    tasks.push((maybeInitAbi as () => Promise<unknown>)());
  }
  if (tasks.length) {
    await Promise.all(tasks);
  }
}

function getCircuitArtifact(circuit: CircuitName): NoirArtifact {
  switch (circuit) {
    case "age_verification":
      return ageCircuit as unknown as NoirArtifact;
    case "doc_validity":
      return docValidityCircuit as unknown as NoirArtifact;
    case "face_match":
      return faceMatchCircuit as unknown as NoirArtifact;
    case "identity_binding":
      return identityBindingCircuit as unknown as NoirArtifact;
    case "nationality_membership":
      return nationalityCircuit as unknown as NoirArtifact;
    default: {
      const _exhaustive: never = circuit;
      throw new Error(`Unknown circuit: ${_exhaustive}`);
    }
  }
}

async function benchmarkCircuit(params: {
  circuit: CircuitName;
  inputFactory: () => Promise<NoirInputMap> | NoirInputMap;
  runs: number;
}): Promise<ZkBenchmarkRow> {
  const artifact = getCircuitArtifact(params.circuit);
  const noir = new Noir(artifact);
  const bb = await getBarretenberg();
  const backend = new UltraHonkBackend(
    (artifact as unknown as { bytecode: string }).bytecode,
    bb
  );
  const verifier = await getVerifierBackend();
  const verificationKey = await backend.getVerificationKey();

  // Warm-up (avoid counting module init, CRS fetch, JIT effects).
  const warmInput = await params.inputFactory();
  const warmWitness = await noir.execute(warmInput);
  await backend.generateProof(warmWitness.witness);

  const proveMs: number[] = [];
  const verifyMs: number[] = [];
  const proofBytes: number[] = [];
  let publicInputCount = 0;

  for (let i = 0; i < params.runs; i++) {
    const input = await params.inputFactory();

    const startProve = performance.now();
    const { witness } = await noir.execute(input);
    const proof = await backend.generateProof(witness);
    const proveDuration = performance.now() - startProve;

    const proofBytesLen = proof.proof.byteLength;
    proofBytes.push(proofBytesLen);
    publicInputCount = proof.publicInputs.length;

    const startVerify = performance.now();
    const isValid = await verifier.verifyProof({
      proof: proof.proof,
      publicInputs: proof.publicInputs,
      verificationKey,
    });
    const verifyDuration = performance.now() - startVerify;
    if (!isValid) {
      throw new Error(`Verification failed for ${params.circuit}`);
    }

    proveMs.push(proveDuration);
    verifyMs.push(verifyDuration);
  }

  return {
    circuit: params.circuit,
    proveMsMedian: Math.round(median(proveMs)),
    verifyMsMedian: Math.round(median(verifyMs)),
    proofBytesMedian: Math.round(median(proofBytes)),
    publicInputCount,
    runs: params.runs,
  };
}

async function benchmarkZk(runs: number): Promise<ZkBenchmarkRow[]> {
  const documentHashField = randomFieldHex();

  const ageDobDays = 33_000;
  const ageCurrentDays = 46_000;
  const minAgeDays = 18 * 365;
  const ageClaimHash = await computeClaimHash({
    value: ageDobDays,
    documentHashField,
  });

  const expiryDate = 20_271_231;
  const currentDate = 20_260_217;
  const docValidityClaimHash = await computeClaimHash({
    value: expiryDate,
    documentHashField,
  });

  const nationalityCode = "DEU";
  const nationalityNumeric = toNumericCode(nationalityCode);
  if (!nationalityNumeric) {
    throw new Error(
      `Failed to compute numeric nationality code for ${nationalityCode}`
    );
  }
  const nationalityClaimHash = await computeClaimHash({
    value: nationalityNumeric,
    documentHashField,
  });

  const faceScore = 8000;
  const faceThreshold = 7500;
  const faceClaimHash = await computeClaimHash({
    value: faceScore,
    documentHashField,
  });

  const bindingSecret = randomFieldHex();
  const userIdHash = randomFieldHex();
  const bindingCommitment = await poseidon2Hash([
    BigInt(bindingSecret),
    BigInt(userIdHash),
    BigInt(documentHashField),
  ]);
  const bindingCommitmentHex = `0x${bindingCommitment.toString(16).padStart(64, "0")}`;

  const nationalityInputs = await generateNationalityProofInputs(
    nationalityCode,
    "EU",
    poseidon2Hash
  );

  return await Promise.all([
    benchmarkCircuit({
      circuit: "age_verification",
      runs,
      inputFactory: () => ({
        dob_days: ageDobDays.toString(),
        document_hash: documentHashField,
        current_days: ageCurrentDays.toString(),
        min_age_days: minAgeDays.toString(),
        nonce: randomNonceFieldHex(),
        claim_hash: ageClaimHash,
      }),
    }),
    benchmarkCircuit({
      circuit: "doc_validity",
      runs,
      inputFactory: () => ({
        expiry_date: expiryDate.toString(),
        document_hash: documentHashField,
        current_date: currentDate.toString(),
        nonce: randomNonceFieldHex(),
        claim_hash: docValidityClaimHash,
      }),
    }),
    benchmarkCircuit({
      circuit: "nationality_membership",
      runs,
      inputFactory: () => ({
        nationality_code: nationalityInputs.nationalityCode.toString(),
        document_hash: documentHashField,
        merkle_root: nationalityInputs.merkleRoot,
        path_elements: nationalityInputs.pathElements,
        path_indices: nationalityInputs.pathIndices,
        nonce: randomNonceFieldHex(),
        claim_hash: nationalityClaimHash,
      }),
    }),
    benchmarkCircuit({
      circuit: "face_match",
      runs,
      inputFactory: () => ({
        similarity_score: faceScore.toString(),
        document_hash: documentHashField,
        threshold: faceThreshold.toString(),
        nonce: randomNonceFieldHex(),
        claim_hash: faceClaimHash,
      }),
    }),
    benchmarkCircuit({
      circuit: "identity_binding",
      runs,
      inputFactory: () => ({
        binding_secret: bindingSecret,
        user_id_hash: userIdHash,
        document_hash: documentHashField,
        nonce: randomNonceFieldHex(),
        binding_commitment: bindingCommitmentHex,
      }),
    }),
  ]);
}

async function benchmarkFhe(runs: number): Promise<FheBenchmarkRow[]> {
  // Key generation is intentionally excluded from timings (it is a UX-visible step).
  const config = tfhe.TfheConfigBuilder.default().build();
  const clientKey = tfhe.TfheClientKey.generate(config);
  const publicKey = tfhe.TfheCompressedPublicKey.new(clientKey);
  const serverKey = tfhe.TfheCompressedServerKey.new(clientKey);
  const publicKeyBytes = publicKey.serialize();
  const serverKeyBytes = serverKey.serialize();

  const registerLatencies: number[] = [];
  let keyId = "";

  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    const result = await fetchFhe<FheRegisterKeyResponse>("/keys/register", {
      publicKey: publicKeyBytes,
      serverKey: serverKeyBytes,
    });
    registerLatencies.push(performance.now() - start);
    keyId = result.keyId;
  }

  const encryptLatencies: number[] = [];
  let dobCiphertext: Uint8Array | null = null;

  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    const encrypted = await fetchFhe<FheEncryptBatchResponse>(
      "/encrypt-batch",
      {
        keyId,
        dobDays: 33_000,
      }
    );
    encryptLatencies.push(performance.now() - start);
    dobCiphertext = encrypted.dobDaysCiphertext ?? null;
    if (!dobCiphertext) {
      throw new Error("FHE encrypt-batch did not return dobDaysCiphertext");
    }
  }

  const verifyLatencies: number[] = [];
  const ciphertext = dobCiphertext;
  if (!ciphertext) {
    throw new Error("FHE verify requires dobDaysCiphertext");
  }
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    await fetchFhe<FheVerifyAgeResponse>("/verify-age-from-dob", {
      ciphertext,
      currentDays: 46_000,
      minAge: 18,
      keyId,
    });
    verifyLatencies.push(performance.now() - start);
  }

  return [
    {
      operation: "key_registration",
      latencyMsMedian: Math.round(median(registerLatencies)),
      runs,
    },
    {
      operation: "encrypt_dob_days",
      latencyMsMedian: Math.round(median(encryptLatencies)),
      runs,
    },
    {
      operation: "verify_age_from_dob",
      latencyMsMedian: Math.round(median(verifyLatencies)),
      runs,
    },
  ];
}

function printSummary(out: BenchmarkOutput): void {
  if (out.zk.length) {
    // eslint-disable-next-line no-console
    console.log("\nZK benchmarks (median):");
    for (const row of out.zk) {
      const kb = row.proofBytesMedian / 1024;
      // eslint-disable-next-line no-console
      console.log(
        `- ${row.circuit}: prove=${row.proveMsMedian}ms verify=${row.verifyMsMedian}ms size=${kb.toFixed(1)}KB pub_inputs=${row.publicInputCount} (n=${row.runs})`
      );
    }
  }
  if (out.fhe.length) {
    // eslint-disable-next-line no-console
    console.log("\nFHE benchmarks (median):");
    for (const row of out.fhe) {
      // eslint-disable-next-line no-console
      console.log(
        `- ${row.operation}: ${row.latencyMsMedian}ms (n=${row.runs})`
      );
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.onlyZk && args.onlyFhe) {
    throw new Error("Use only one of --only-zk or --only-fhe");
  }

  await Promise.all([
    initNoirRuntime(),
    getBarretenberg(),
    getVerifierBackend(),
  ]);

  const doZk = !args.onlyFhe;
  const doFhe = !(args.skipFhe || args.onlyZk);

  const output: BenchmarkOutput = {
    meta: {
      timestamp: new Date().toISOString(),
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      runsZk: args.runsZk,
      runsFhe: args.runsFhe,
    },
    zk: [],
    fhe: [],
  };

  if (doZk) {
    output.zk = await benchmarkZk(args.runsZk);
  }
  if (doFhe) {
    output.fhe = await benchmarkFhe(args.runsFhe);
  }

  writeFileSync(args.out, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  printSummary(output);

  // eslint-disable-next-line no-console
  console.log(`\nWrote ${args.out}`);
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
