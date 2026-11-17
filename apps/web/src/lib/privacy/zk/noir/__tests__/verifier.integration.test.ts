import type { ProofType } from "../../proof-types";

import { randomBytes } from "node:crypto";

import {
  BackendType as BackendTypeV5,
  Barretenberg as BarretenbergV5,
  UltraHonkBackend as UltraHonkBackendV5,
} from "@aztec/bb.js";
import { UltraHonkBackend } from "@aztec-foundation/bb.js";
import { Noir } from "@noir-lang/noir_js";
import { afterAll, describe, expect, it } from "vitest";

import { env } from "@/env";
import {
  getBarretenberg,
  poseidon2Hash,
} from "@/lib/privacy/primitives/barretenberg";
import docValidityCircuit from "@/noir-circuits/doc_validity/artifacts/doc_validity.json" with {
  type: "json",
};

import { getCircuitVerificationKey, verifyNoirProof } from "../verifier";

const BB_TIMEOUT_MS = 120_000;
const BB6_VERSION = /^6\./;

// SHA-256 of each circuit's verification key, as proof metadata stores it.
// Barretenberg 5 and 6 derive the same keys; a change here means stored hashes
// no longer describe the deployed circuits.
const VERIFICATION_KEY_SHA256: Record<ProofType, string> = {
  age_verification:
    "85f6cec90243f4abf51432a3c005c72cc924a1c7298ef7d0322f3a196af06423",
  doc_validity:
    "75ebe3cf1380a2de8b05173d09fbeb79d75eff5485d6d06c8057d14d8eecf9d1",
  face_match:
    "d22aacf80b2b44e0fe95f6fafacad017eee32708b754af8aa718330ce97a7e54",
  identity_binding:
    "7bbd0b57acd0ca8cfc124a6444ab5e17cee9113ea2376742d8e033604950a3c4",
  nationality_membership:
    "6f8b30d044efb1abcc5f9b8ff601a588bb95b6bd108ff1a9d7de998878e47d42",
};

function toFieldHex(value: bigint): string {
  return `0x${value.toString(16).padStart(64, "0")}`;
}

async function executeDocValidity() {
  const documentHash = BigInt(`0x${randomBytes(31).toString("hex")}`);
  const expiryDate = 20_301_231n;
  const claimHash = await poseidon2Hash([expiryDate, documentHash]);
  const noir = new Noir(docValidityCircuit as never);
  const { witness } = await noir.execute({
    expiry_date: expiryDate.toString(),
    document_hash: toFieldHex(documentHash),
    current_date: "20261117",
    nonce: `0x${randomBytes(16).toString("hex")}`,
    claim_hash: toFieldHex(claimHash),
  });
  return witness;
}

let legacyBarretenberg: BarretenbergV5 | undefined;

afterAll(async () => {
  await legacyBarretenberg?.destroy();
});

describe("Noir verifier on Barretenberg 6", () => {
  it.each(Object.entries(VERIFICATION_KEY_SHA256) as [ProofType, string][])(
    "keeps the %s verification key",
    async (circuitType, expectedHash) => {
      const key = await getCircuitVerificationKey(circuitType);
      expect(key.verificationKeyHash).toBe(expectedHash);
    },
    BB_TIMEOUT_MS
  );

  it(
    "verifies a proof from the Barretenberg 6 prover",
    async () => {
      const backend = new UltraHonkBackend(
        docValidityCircuit.bytecode,
        await getBarretenberg()
      );
      const proof = await backend.generateProof(await executeDocValidity());

      const result = await verifyNoirProof({
        circuitType: "doc_validity",
        proof: Buffer.from(proof.proof).toString("base64"),
        publicInputs: proof.publicInputs,
      });

      expect(result.isValid).toBe(true);
      expect(result.bbVersion).toMatch(BB6_VERSION);
      expect(result.verificationKeyHash).toBe(
        VERIFICATION_KEY_SHA256.doc_validity
      );
    },
    BB_TIMEOUT_MS
  );

  it(
    "rejects a proof from a Barretenberg 5 prover",
    async () => {
      // A browser still running the previous worker would send these
      legacyBarretenberg = await BarretenbergV5.new({
        crsPath: env.BB_CRS_PATH,
        backend: BackendTypeV5.Wasm,
      });
      const backend = new UltraHonkBackendV5(
        docValidityCircuit.bytecode,
        legacyBarretenberg
      );
      const proof = await backend.generateProof(await executeDocValidity());

      const result = await verifyNoirProof({
        circuitType: "doc_validity",
        proof: Buffer.from(proof.proof).toString("base64"),
        publicInputs: proof.publicInputs,
      });

      expect(result.isValid).toBe(false);
    },
    BB_TIMEOUT_MS
  );
});
