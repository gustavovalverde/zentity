import type { ProofResult, QueryResult } from "@zkpassport/utils";
import type { Alpha3Code } from "i18n-iso-countries";

import {
  formatBoundData,
  getAgeParameterCommitment,
  getBindParameterCommitment,
  getCountryParameterCommitment,
  getFacematchParameterCommitment,
  getServiceScopeHash,
  getServiceSubscopeHash,
  NullifierType,
  ProofType,
  VerificationMethod,
} from "@zkpassport/utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetSolidityVerifierDetails,
  mockGetSolidityVerifierParameters,
  mockLoggerWarn,
  mockReadContract,
  mockRegistryClient,
  mockVerifyProofV5,
  mockVerifyProofV6,
} = vi.hoisted(() => ({
  mockGetSolidityVerifierDetails: vi.fn(),
  mockGetSolidityVerifierParameters: vi.fn(),
  mockLoggerWarn: vi.fn(),
  mockReadContract: vi.fn(),
  mockRegistryClient: {
    getCircuitManifest: vi.fn(),
    getLatestAttestationRevocationRoot: vi.fn(),
    getPackagedCircuit: vi.fn(),
    isAttestationRevocationRootValid: vi.fn(),
    isCertificateRootValid: vi.fn(),
    isCircuitRootValid: vi.fn(),
  },
  mockVerifyProofV5: vi.fn(),
  mockVerifyProofV6: vi.fn(),
}));

vi.mock("@zkpassport/registry", () => ({
  RegistryClient: class {
    getCircuitManifest = mockRegistryClient.getCircuitManifest;
    getLatestAttestationRevocationRoot =
      mockRegistryClient.getLatestAttestationRevocationRoot;
    getPackagedCircuit = mockRegistryClient.getPackagedCircuit;
    isAttestationRevocationRootValid =
      mockRegistryClient.isAttestationRevocationRootValid;
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

// Records which Barretenberg major verified each proof
vi.mock("@aztec/bb.js", () => ({
  BackendType: { Wasm: "Wasm" },
  Barretenberg: { new: () => Promise.resolve({}) },
  UltraHonkVerifierBackend: class {
    verifyProof = mockVerifyProofV5;
  },
}));

vi.mock("@aztec-foundation/bb.js", () => ({
  BackendType: { Wasm: "Wasm" },
  Barretenberg: { new: () => Promise.resolve({}) },
  UltraHonkVerifierBackend: class {
    verifyProof = mockVerifyProofV6;
  },
}));

vi.mock("@/lib/privacy/primitives/barretenberg", () => ({
  getBarretenberg: () => Promise.resolve({}),
}));

vi.mock("viem", () => ({
  createPublicClient: vi.fn(() => ({
    readContract: mockReadContract,
  })),
  http: vi.fn((url: string) => url),
}));

vi.mock("viem/chains", () => ({
  mainnet: { id: 1 },
  sepolia: { id: 11_155_111 },
}));

vi.mock("@/lib/logging/logger", () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: mockLoggerWarn,
  },
}));

type VerifierModule = typeof import("../zkpassport-verifier");
interface VerifierTestApi {
  computeExpectedDisclosureCommitment: (
    proofName: string,
    query: Record<string, unknown>
  ) => Promise<string | null>;
  getBarretenbergGeneration: (circuitVersion: string) => "v5" | "v6";
  reset(): void;
  validateRootOnChain: (
    rootType: "certificate" | "circuit",
    rootHex: string,
    chainId: number
  ) => Promise<boolean>;
  verifyOuterEvmProofOnChain: (params: {
    proof: unknown;
    domain: string;
    scope?: string;
    validity?: number;
    devMode?: boolean;
  }) => Promise<boolean>;
}

async function getVerifierModule() {
  return (await import("../zkpassport-verifier")) as VerifierModule & {
    verifyZkPassportProofs: VerifierModule["verifyZkPassportProofs"] & {
      __testOnly: VerifierTestApi;
    };
  };
}

async function getTestApi(): Promise<VerifierTestApi> {
  const module = await getVerifierModule();
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
      testApi.validateRootOnChain("certificate", "deadbeef", 1)
    ).resolves.toBe(false);
    await expect(
      testApi.validateRootOnChain("certificate", "deadbeef", 1)
    ).resolves.toBe(true);
    await expect(
      testApi.validateRootOnChain("certificate", "deadbeef", 1)
    ).resolves.toBe(true);

    expect(mockRegistryClient.isCertificateRootValid).toHaveBeenCalledTimes(2);
  });

  it("fails closed on circuit registry lookup errors without caching them", async () => {
    mockRegistryClient.isCircuitRootValid
      .mockRejectedValueOnce(new Error("rpc unavailable"))
      .mockResolvedValueOnce(true);

    const testApi = await getTestApi();

    await expect(
      testApi.validateRootOnChain("circuit", "feedface", 1)
    ).resolves.toBe(false);
    await expect(
      testApi.validateRootOnChain("circuit", "feedface", 1)
    ).resolves.toBe(true);
    await expect(
      testApi.validateRootOnChain("circuit", "feedface", 1)
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

// ---------------------------------------------------------------------------
// Proof sets as the ZKPassport app returns them in fast mode: three chip proofs
// (DSC, ID data, integrity) and the disclosure proofs they commit to. Public
// inputs follow the @zkpassport/utils layouts; the proof bytes are filler, so
// the Barretenberg backends are mocked.
// ---------------------------------------------------------------------------

const DOMAIN = "zentity.test";
const SCOPE = "zentity:nfc-chip:identity-verification:v1";
const BINDING = "zentity:nfc-chip:session:binding";
const NULLIFIER = 987_654_321n;
const DSC_COMMITMENT = 11n;
const ID_DATA_COMMITMENT = 12n;
const INTEGRITY_COMMITMENT = 13n;
const APPLE_APP_ATTEST_ROOT_KEY_HASH =
  "0x2532418a107c5306fa8308c22255792cf77e4a290cbce8a840a642a3e591340b";
const GOOGLE_RSA_ROOT_KEY_HASH =
  "0x16700a2d9168a194fc85f237af5829b5a2be05b8ae8ac4879ada34cf54a9c211";
const IOS_APP_ID_HASH =
  "0x1fa73686cf510f8f85757b0602de0dd72a13e68ae2092462be8b72662e7f179b";
const ANDROID_APP_ID_HASH =
  "0x24d9929b248be7eeecaa98e105c034a50539610f3fdd4cb9c8983ef4100d615d";

interface FacematchInputs {
  appIdHash: string;
  environment: "development" | "production";
  integrityPubkeyHash: string;
  mode: "regular" | "strict";
  revocationRoot?: string;
  rootKeyLeaf: string;
}

const IOS_FACEMATCH: FacematchInputs = {
  appIdHash: IOS_APP_ID_HASH,
  environment: "production",
  integrityPubkeyHash: "0x0",
  mode: "strict",
  revocationRoot: "0x0",
  rootKeyLeaf: APPLE_APP_ATTEST_ROOT_KEY_HASH,
};

interface ProofSetOptions {
  extraProofs?: ProofResult[];
  facematch?: FacematchInputs;
  /** The method the integrity proof states (circuits 0.23.0 and later) */
  integrityMethod?: number;
  /** Per-proof nullifier overrides, by proof name */
  nullifiers?: Record<string, bigint>;
  version: NonNullable<ProofResult["version"]>;
}

function toField(value: bigint | number): string {
  return BigInt(value).toString(16).padStart(64, "0");
}

function encodeProof(publicInputs: (bigint | number)[]): string {
  return [...publicInputs, 1n, 2n].map(toField).join("");
}

function supportsVerificationMethod(version: string): boolean {
  const [major = 0, minor = 0] = version.split(".").map(Number);
  return major > 0 || minor >= 23;
}

async function buildChipProofSet(options: ProofSetOptions): Promise<{
  proofs: ProofResult[];
  queryResult: QueryResult;
}> {
  const { version } = options;
  const facematch = options.facematch ?? IOS_FACEMATCH;
  const withMethod = supportsVerificationMethod(version);
  const now = Math.floor(Date.now() / 1000);
  const scopeHash = getServiceScopeHash(DOMAIN);
  const subscopeHash = getServiceSubscopeHash(SCOPE);

  const disclosure = async (
    name: string,
    paramCommitment: bigint,
    nullifierType: NullifierType,
    nullifier: bigint,
    committedInputs: Record<string, unknown>
  ): Promise<ProofResult> => ({
    name,
    version,
    proof: encodeProof([
      INTEGRITY_COMMITMENT,
      now,
      scopeHash,
      subscopeHash,
      paramCommitment,
      nullifierType,
      options.nullifiers?.[name] ?? nullifier,
      0n,
    ]),
    committedInputs: committedInputs as ProofResult["committedInputs"],
  });

  const ageCommitment = await getAgeParameterCommitment(18, 0);
  const bindCommitment = await getBindParameterCommitment(
    formatBoundData({ custom_data: BINDING })
  );
  const facematchCommitment = await getFacematchParameterCommitment(
    BigInt(facematch.rootKeyLeaf),
    facematch.environment === "development" ? 0n : 1n,
    BigInt(facematch.appIdHash),
    facematch.mode === "regular" ? 1n : 2n,
    undefined,
    BigInt(facematch.revocationRoot ?? 0),
    withMethod
  );

  const proofs: ProofResult[] = [
    {
      name: "sig_check_dsc_tbs_700_rsa_pkcs_4096_sha256",
      version,
      proof: encodeProof([0xabcn, DSC_COMMITMENT]),
    },
    {
      name: "sig_check_id_data_tbs_700_rsa_pkcs_2048_sha256",
      version,
      proof: encodeProof([DSC_COMMITMENT, ID_DATA_COMMITMENT]),
    },
    {
      name: "data_check_integrity_sa_sha256_dg_sha256",
      version,
      proof: encodeProof(
        withMethod
          ? [
              ID_DATA_COMMITMENT,
              INTEGRITY_COMMITMENT,
              options.integrityMethod ?? VerificationMethod.ICAO_CHIP,
            ]
          : [ID_DATA_COMMITMENT, INTEGRITY_COMMITMENT]
      ),
    },
    await disclosure(
      "compare_age",
      ageCommitment,
      NullifierType.NON_SALTED,
      NULLIFIER,
      { compare_age: { minAge: 18, maxAge: 0 } }
    ),
    await disclosure(
      "bind",
      bindCommitment,
      NullifierType.NON_SALTED,
      NULLIFIER,
      { bind: { data: { custom_data: BINDING } } }
    ),
    // A face match carries no nullifier
    await disclosure(
      "facematch_ios",
      facematchCommitment,
      NullifierType.NONE,
      0n,
      {
        facematch,
      }
    ),
    ...(options.extraProofs ?? []),
  ];

  const queryResult = {
    age: { gte: { expected: 18, result: true } },
    bind: { custom_data: BINDING },
    facematch: { mode: facematch.mode, passed: true },
  } as unknown as QueryResult;

  return { proofs, queryResult };
}

async function verifyProofSet(proofs: ProofResult[], queryResult: QueryResult) {
  const { verifyZkPassportProofs } = await getVerifierModule();
  return verifyZkPassportProofs({
    domain: DOMAIN,
    proofs,
    queryResult,
    scope: SCOPE,
    validity: 600,
  });
}

describe("zkpassport-verifier proof sets", () => {
  beforeEach(async () => {
    vi.resetModules();
    for (const mock of Object.values(mockRegistryClient)) {
      mock.mockReset();
    }
    mockLoggerWarn.mockReset();
    mockVerifyProofV5.mockReset().mockResolvedValue(true);
    mockVerifyProofV6.mockReset().mockResolvedValue(true);
    mockRegistryClient.isCertificateRootValid.mockResolvedValue(true);
    mockRegistryClient.isCircuitRootValid.mockResolvedValue(true);
    mockRegistryClient.getCircuitManifest.mockImplementation(
      (_root: unknown, options: { version: string }) =>
        Promise.resolve({ version: options.version, root: "0x1", circuits: {} })
    );
    mockRegistryClient.getPackagedCircuit.mockResolvedValue({
      vkey: Buffer.from("verification-key").toString("base64"),
    });

    const testApi = await getTestApi();
    testApi.reset();
  });

  it.each([
    ["0.20.0", "v5"],
    ["0.21.1", "v5"],
    ["0.21.99", "v5"],
    ["0.22.0", "v6"],
    ["0.23.0", "v6"],
    ["0.23.0-rc.1", "v6"],
    ["1.0.0", "v6"],
  ] as const)(
    "verifies circuits %s with Barretenberg %s",
    async (version, generation) => {
      const testApi = await getTestApi();
      expect(testApi.getBarretenbergGeneration(version)).toBe(generation);
    }
  );

  it("accepts a 0.23.0 chip proof set and verifies it with Barretenberg 6", async () => {
    const { proofs, queryResult } = await buildChipProofSet({
      version: "0.23.0",
    });

    const result = await verifyProofSet(proofs, queryResult);

    expect(result.queryResultErrors).toBeUndefined();
    expect(result.verified).toBe(true);
    expect(result.chipNullifier).toBe(NULLIFIER.toString(10));
    expect(result.chipNullifierType).toBe(NullifierType.NON_SALTED);
    expect(mockVerifyProofV6).toHaveBeenCalledTimes(proofs.length);
    expect(mockVerifyProofV5).not.toHaveBeenCalled();
    expect(mockRegistryClient.getCircuitManifest).toHaveBeenCalledWith(
      undefined,
      { version: "0.23.0" }
    );
  });

  it("verifies a 0.21.1 chip proof set with Barretenberg 5", async () => {
    const { proofs, queryResult } = await buildChipProofSet({
      version: "0.21.1",
    });

    const result = await verifyProofSet(proofs, queryResult);

    expect(result.queryResultErrors).toBeUndefined();
    expect(result.verified).toBe(true);
    expect(result.chipNullifier).toBe(NULLIFIER.toString(10));
    expect(mockVerifyProofV5).toHaveBeenCalledTimes(proofs.length);
    expect(mockVerifyProofV6).not.toHaveBeenCalled();
  });

  it("fails when the backend for the proof version rejects a proof", async () => {
    mockVerifyProofV6.mockResolvedValue(false);
    const { proofs, queryResult } = await buildChipProofSet({
      version: "0.23.0",
    });

    const result = await verifyProofSet(proofs, queryResult);

    expect(result.verified).toBe(false);
    expect(result.chipNullifier).toBeUndefined();
  });

  it("rejects proofs that state different circuit versions", async () => {
    const { proofs, queryResult } = await buildChipProofSet({
      version: "0.23.0",
    });
    const mixed = proofs.map((proof, index) =>
      index === 0 ? { ...proof, version: "0.21.1" as const } : proof
    );

    const result = await verifyProofSet(mixed, queryResult);

    expect(result.verified).toBe(false);
    expect(result.queryResultErrors).toHaveProperty("proofs.version");
    expect(mockRegistryClient.isCertificateRootValid).not.toHaveBeenCalled();
    expect(mockVerifyProofV5).not.toHaveBeenCalled();
    expect(mockVerifyProofV6).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", undefined],
    ["malformed", "latest"],
  ])("rejects proofs with a %s circuit version", async (_label, version) => {
    const { proofs, queryResult } = await buildChipProofSet({
      version: "0.23.0",
    });
    const unversioned = proofs.map((proof) => ({ ...proof, version }));

    const result = await verifyProofSet(
      unversioned as ProofResult[],
      queryResult
    );

    expect(result.verified).toBe(false);
    expect(result.queryResultErrors).toHaveProperty("proofs.version");
  });

  it.each([
    ["Aadhaar", VerificationMethod.UIDAI_AADHAAR],
    ["JPKI", VerificationMethod.JPKI],
    ["mDoc", VerificationMethod.ISO_MDOC],
    ["an iOS camera capture", VerificationMethod.ATTESTED_CAPTURE_IOS],
  ])("rejects an ID verified by %s", async (_label, integrityMethod) => {
    const { proofs, queryResult } = await buildChipProofSet({
      integrityMethod,
      version: "0.23.0",
    });

    const result = await verifyProofSet(proofs, queryResult);

    expect(result.verified).toBe(false);
    expect(result.queryResultErrors).toHaveProperty(
      "verification_method.eq.received",
      String(integrityMethod)
    );
    expect(mockVerifyProofV6).not.toHaveBeenCalled();
  });

  it("rejects an integrity proof that states an unknown verification method", async () => {
    const { proofs, queryResult } = await buildChipProofSet({
      integrityMethod: 0,
      version: "0.23.0",
    });

    const result = await verifyProofSet(proofs, queryResult);

    expect(result.verified).toBe(false);
    expect(result.queryResultErrors).toHaveProperty("verification_method");
  });

  it.each(["attested_id_ios", "aadhaar_id", "outer_attested_id_count_4"])(
    "rejects the chipless base proof %s",
    async (name) => {
      const proof: ProofResult = {
        name,
        version: "0.23.0",
        proof: encodeProof([1n, 2n, 3n]),
      };

      const result = await verifyProofSet([proof], {} as QueryResult);

      expect(result.verified).toBe(false);
      expect(result.queryResultErrors).toHaveProperty("verification_method");
      expect(mockRegistryClient.getCircuitManifest).not.toHaveBeenCalled();
    }
  );

  it("rejects a standalone EVM disclosure proof", async () => {
    const ageCommitment = await getAgeParameterCommitment(18, 0);
    const { proofs, queryResult } = await buildChipProofSet({
      extraProofs: [
        {
          name: "compare_age_evm",
          version: "0.23.0",
          proof: encodeProof([
            INTEGRITY_COMMITMENT,
            Math.floor(Date.now() / 1000),
            getServiceScopeHash(DOMAIN),
            getServiceSubscopeHash(SCOPE),
            ageCommitment,
            NullifierType.NON_SALTED,
            NULLIFIER,
            0n,
          ]),
          committedInputs: {
            compare_age_evm: { minAge: 18, maxAge: 0 },
          } as unknown as ProofResult["committedInputs"],
        },
      ],
      version: "0.23.0",
    });

    const result = await verifyProofSet(proofs, queryResult);

    expect(result.verified).toBe(false);
    expect(result.queryResultErrors).toHaveProperty(
      "proof.name.received",
      "compare_age_evm"
    );
  });

  it("rejects an outer proof sent with other proofs", async () => {
    const { proofs, queryResult } = await buildChipProofSet({
      extraProofs: [
        {
          name: "outer_count_5",
          version: "0.23.0",
          proof: encodeProof(Array.from({ length: 11 }, () => 0n)),
        },
      ],
      version: "0.23.0",
    });

    const result = await verifyProofSet(proofs, queryResult);

    expect(result.verified).toBe(false);
    expect(result.queryResultErrors).toHaveProperty("outer.proof_count");
  });

  it("rejects disclosure proofs that carry different nullifiers", async () => {
    const { proofs, queryResult } = await buildChipProofSet({
      nullifiers: { bind: NULLIFIER + 1n },
      version: "0.23.0",
    });

    const result = await verifyProofSet(proofs, queryResult);

    expect(result.verified).toBe(false);
    expect(result.queryResultErrors).toHaveProperty("nullifier");
  });

  it("checks an Android face match's revocation root against the registry", async () => {
    mockRegistryClient.isAttestationRevocationRootValid.mockResolvedValue(
      false
    );
    const { proofs, queryResult } = await buildChipProofSet({
      facematch: {
        appIdHash: ANDROID_APP_ID_HASH,
        environment: "production",
        integrityPubkeyHash: "0x1",
        mode: "strict",
        revocationRoot: "0x1234",
        rootKeyLeaf: GOOGLE_RSA_ROOT_KEY_HASH,
      },
      version: "0.23.0",
    });

    const rejected = await verifyProofSet(proofs, queryResult);

    expect(rejected.verified).toBe(false);
    expect(rejected.queryResultErrors).toHaveProperty("facematch.revocation");
    expect(
      mockRegistryClient.isAttestationRevocationRootValid
    ).toHaveBeenCalledWith("0x1234");

    const testApi = await getTestApi();
    testApi.reset();
    mockRegistryClient.isAttestationRevocationRootValid.mockResolvedValue(true);

    const accepted = await verifyProofSet(proofs, queryResult);

    expect(accepted.queryResultErrors).toBeUndefined();
    expect(accepted.verified).toBe(true);
  });

  it("rejects an iOS face match that names a revocation root", async () => {
    const { proofs, queryResult } = await buildChipProofSet({
      facematch: { ...IOS_FACEMATCH, revocationRoot: "0x1234" },
      version: "0.23.0",
    });

    const result = await verifyProofSet(proofs, queryResult);

    expect(result.verified).toBe(false);
    expect(result.queryResultErrors).toHaveProperty("facematch.revocation");
  });
});
