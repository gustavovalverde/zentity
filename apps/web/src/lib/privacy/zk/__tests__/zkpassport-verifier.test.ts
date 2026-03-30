import type { Alpha3Code } from "i18n-iso-countries";

import { getCountryParameterCommitment, ProofType } from "@zkpassport/utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetSolidityVerifierDetails,
  mockGetSolidityVerifierParameters,
  mockLoggerWarn,
  mockReadContract,
  mockRegistryClient,
} = vi.hoisted(() => ({
  mockGetSolidityVerifierDetails: vi.fn(),
  mockGetSolidityVerifierParameters: vi.fn(),
  mockLoggerWarn: vi.fn(),
  mockReadContract: vi.fn(),
  mockRegistryClient: {
    isCertificateRootValid: vi.fn(),
    isCircuitRootValid: vi.fn(),
  },
}));

vi.mock("@zkpassport/registry", () => ({
  RegistryClient: class {
    isCertificateRootValid = mockRegistryClient.isCertificateRootValid;
    isCircuitRootValid = mockRegistryClient.isCircuitRootValid;
  },
}));

vi.mock("@zkpassport/sdk", () => ({
  ZKPassport: class {
    getSolidityVerifierDetails = mockGetSolidityVerifierDetails;
    getSolidityVerifierParameters = mockGetSolidityVerifierParameters;
  },
}));

vi.mock("viem", () => ({
  createPublicClient: vi.fn(() => ({
    readContract: mockReadContract,
  })),
  http: vi.fn((url: string) => url),
}));

vi.mock("viem/chains", () => ({
  sepolia: { id: 11_155_111 },
}));

vi.mock("@/lib/logging/logger", () => ({
  logger: {
    warn: mockLoggerWarn,
  },
}));

type VerifierModule = typeof import("../zkpassport-verifier");
interface VerifierTestApi {
  computeExpectedDisclosureCommitment: (
    proofName: string,
    query: Record<string, unknown>
  ) => Promise<string | null>;
  reset(): void;
  validateRootOnChain: (
    rootType: "certificate" | "circuit",
    rootHex: string
  ) => Promise<boolean>;
  verifyOuterEvmProofOnChain: (params: {
    proof: unknown;
    domain: string;
    scope?: string;
    validity?: number;
    devMode?: boolean;
  }) => Promise<boolean>;
}

async function getTestApi(): Promise<VerifierTestApi> {
  const module = (await import("../zkpassport-verifier")) as VerifierModule & {
    verifyZkPassportProofs: VerifierModule["verifyZkPassportProofs"] & {
      __testOnly: VerifierTestApi;
    };
  };

  return module.verifyZkPassportProofs.__testOnly;
}

describe("zkpassport-verifier root validation", () => {
  beforeEach(async () => {
    vi.resetModules();
    mockGetSolidityVerifierDetails.mockReset();
    mockGetSolidityVerifierParameters.mockReset();
    mockLoggerWarn.mockReset();
    mockReadContract.mockReset();
    mockRegistryClient.isCertificateRootValid.mockReset();
    mockRegistryClient.isCircuitRootValid.mockReset();

    const testApi = await getTestApi();
    testApi.reset();
  });

  it("fails closed on certificate registry lookup errors without caching them", async () => {
    mockRegistryClient.isCertificateRootValid
      .mockRejectedValueOnce(new Error("rpc unavailable"))
      .mockResolvedValueOnce(true);

    const testApi = await getTestApi();

    await expect(
      testApi.validateRootOnChain("certificate", "deadbeef")
    ).resolves.toBe(false);
    await expect(
      testApi.validateRootOnChain("certificate", "deadbeef")
    ).resolves.toBe(true);
    await expect(
      testApi.validateRootOnChain("certificate", "deadbeef")
    ).resolves.toBe(true);

    expect(mockRegistryClient.isCertificateRootValid).toHaveBeenCalledTimes(2);
  });

  it("fails closed on circuit registry lookup errors without caching them", async () => {
    mockRegistryClient.isCircuitRootValid
      .mockRejectedValueOnce(new Error("rpc unavailable"))
      .mockResolvedValueOnce(true);

    const testApi = await getTestApi();

    await expect(
      testApi.validateRootOnChain("circuit", "feedface")
    ).resolves.toBe(false);
    await expect(
      testApi.validateRootOnChain("circuit", "feedface")
    ).resolves.toBe(true);
    await expect(
      testApi.validateRootOnChain("circuit", "feedface")
    ).resolves.toBe(true);

    expect(mockRegistryClient.isCircuitRootValid).toHaveBeenCalledTimes(2);
  });

  it("sorts exclusion country lists before hashing parameter commitments", async () => {
    const testApi = await getTestApi();
    const countries: Alpha3Code[] = ["USA", "BRA", "FRA"];

    const actual = await testApi.computeExpectedDisclosureCommitment(
      "exclusion_check_nationality",
      {
        exclusion_check_nationality: { countries },
      }
    );
    const expected = await getCountryParameterCommitment(
      ProofType.NATIONALITY_EXCLUSION,
      [...countries],
      true
    );

    expect(actual).toBe(expected);
  });

  it("verifies outer_evm proofs via the on-chain wrapper verifier", async () => {
    mockGetSolidityVerifierDetails.mockReturnValue({
      address: "0x1D000001000EFD9a6371f4d90bB8920D5431c0D8",
      abi: [],
      functionName: "verify",
    });
    mockGetSolidityVerifierParameters.mockReturnValue({ proof: "payload" });
    mockReadContract.mockResolvedValue([true]);

    const testApi = await getTestApi();
    const proof = {
      name: "outer_evm_v1",
      proof: "0xproof",
      vkeyHash: "0xabc",
      version: "1.0.0",
      committedInputs: {},
    } as never;

    await expect(
      testApi.verifyOuterEvmProofOnChain({
        proof,
        domain: "localhost",
        scope: "passport-chip",
        validity: 600,
        devMode: true,
      })
    ).resolves.toBe(true);

    expect(mockGetSolidityVerifierParameters).toHaveBeenCalledWith({
      proof,
      validityPeriodInSeconds: 600,
      domain: "localhost",
      scope: "passport-chip",
      devMode: true,
    });
    expect(mockReadContract).toHaveBeenCalledWith({
      address: "0x1D000001000EFD9a6371f4d90bB8920D5431c0D8",
      abi: [],
      functionName: "verify",
      args: [{ proof: "payload" }],
    });
  });
});
