import type { ProofResult, QueryResult } from "@zkpassport/utils";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import fixture from "./fixtures/zkpassport-outer-count-5-v0.22.0.json" with {
  type: "json",
};

const { mockRegistryClient } = vi.hoisted(() => ({
  mockRegistryClient: {
    getCircuitManifest: vi.fn(),
    getPackagedCircuit: vi.fn(),
    isCertificateRootValid: vi.fn(),
    isCircuitRootValid: vi.fn(),
  },
}));

// The fixture was proved over a mock passport, whose certificate root no
// on-chain registry holds; everything else runs for real.
vi.mock("@zkpassport/registry", () => ({
  RegistryClient: class {
    getCircuitManifest = mockRegistryClient.getCircuitManifest;
    getPackagedCircuit = mockRegistryClient.getPackagedCircuit;
    isCertificateRootValid = mockRegistryClient.isCertificateRootValid;
    isCircuitRootValid = mockRegistryClient.isCircuitRootValid;
  },
}));

const BB_TIMEOUT_MS = 120_000;
const FIXTURE_NULLIFIER = BigInt(
  `0x${fixture.proof.proof.slice(8 * 64, 9 * 64)}`
).toString(10);

function verify(proof: ProofResult) {
  return import("../zkpassport-verifier").then(({ verifyZkPassportProofs }) =>
    verifyZkPassportProofs({
      domain: fixture.domain,
      proofs: [proof],
      queryResult: {} as QueryResult,
      validity: 600,
    })
  );
}

describe("ZKPassport verifier with a real outer proof", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(fixture.nowTimestamp * 1000);
    mockRegistryClient.isCertificateRootValid.mockResolvedValue(true);
    mockRegistryClient.isCircuitRootValid.mockImplementation((root: string) =>
      Promise.resolve(BigInt(`0x${root}`) === BigInt(fixture.manifestRoot))
    );
    mockRegistryClient.getCircuitManifest.mockResolvedValue({
      version: fixture.proof.version,
      root: fixture.manifestRoot,
      circuits: { [fixture.proof.name]: { hash: fixture.circuitHash } },
    });
    mockRegistryClient.getPackagedCircuit.mockResolvedValue({
      name: fixture.proof.name,
      vkey: fixture.vkey,
      vkey_hash: fixture.vkeyHash,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it(
    "verifies a circuits 0.22.0 proof with Barretenberg 6",
    async () => {
      const result = await verify(fixture.proof as ProofResult);

      expect(result.queryResultErrors).toBeUndefined();
      expect(result.verified).toBe(true);
      expect(result.chipNullifier).toBe(FIXTURE_NULLIFIER);
    },
    BB_TIMEOUT_MS
  );

  it(
    "does not verify the same proof under Barretenberg 5",
    async () => {
      // Claiming an older release routes the proof to the bb 5 verifier,
      // which cannot verify a bb 6 proof
      const result = await verify({
        ...(fixture.proof as ProofResult),
        version: "0.21.1",
      });

      expect(result.queryResultErrors).toBeUndefined();
      expect(result.verified).toBe(false);
      expect(result.chipNullifier).toBeUndefined();
    },
    BB_TIMEOUT_MS
  );
});
