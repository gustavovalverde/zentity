/**
 * Integration tests for attestation router.
 */

import type { SecurityPosture } from "@/lib/assurance/types";
import type { Session } from "@/lib/auth/auth";

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mockGetEnabledNetworks = vi.fn();
const mockGetNetworkById = vi.fn();
const mockCanCreateProvider = vi.fn();
const mockCreateProvider = vi.fn();
const mockGetExplorerTxUrl = vi.fn();
const mockGetVerificationStatus = vi.fn();
const mockGetSelectedVerification = vi.fn();
const mockGetBlockchainAttestationsByUserId = vi.fn();
const mockGetBlockchainAttestationByUserAndNetwork = vi.fn();
const mockCreateBlockchainAttestation = vi.fn();
const mockGetAttestationEvidenceByUserAndVerification = vi.fn();
const mockResetBlockchainAttestation = vi.fn();
const mockUpdateBlockchainAttestationSubmitted = vi.fn();
const mockUpdateBlockchainAttestationFailed = vi.fn();
const mockUpdateBlockchainAttestationConfirmed = vi.fn();
const mockUpdateBlockchainAttestationWallet = vi.fn();
const mockUpsertAttestationEvidence = vi.fn();
const mockGetSecurityPosture = vi.fn();

// All mocks must be hoisted before any imports
vi.mock("@/lib/blockchain/networks", () => ({
  getEnabledNetworks: (...args: unknown[]) => mockGetEnabledNetworks(...args),
  getNetworkById: (...args: unknown[]) => mockGetNetworkById(...args),
  getExplorerTxUrl: (...args: unknown[]) => mockGetExplorerTxUrl(...args),
}));

vi.mock("@/lib/blockchain/providers/factory", () => ({
  canCreateProvider: (...args: unknown[]) => mockCanCreateProvider(...args),
  createProvider: (...args: unknown[]) => mockCreateProvider(...args),
}));

const mockGetUnifiedVerificationModel = vi.fn();
const mockGetIdentityBundleByUserId = vi.fn();
const mockVerifyWalletOwnership = vi.fn();
const mockComputeProofSetHash = vi.fn();
vi.mock("@/lib/identity/verification/unified-model", () => ({
  getUnifiedVerificationModel: (...args: unknown[]) =>
    mockGetUnifiedVerificationModel(...args),
}));

vi.mock("@/lib/blockchain/wallet-verification", () => ({
  verifyWalletOwnership: (...args: unknown[]) =>
    mockVerifyWalletOwnership(...args),
}));

vi.mock("@/lib/blockchain/attestation/proof-set-hash", () => ({
  computeProofSetHash: (...args: unknown[]) => mockComputeProofSetHash(...args),
}));

vi.mock("@/lib/db/queries/attestation", () => ({
  getBlockchainAttestationsByUserId: (...args: unknown[]) =>
    mockGetBlockchainAttestationsByUserId(...args),
  getBlockchainAttestationByUserAndNetwork: (...args: unknown[]) =>
    mockGetBlockchainAttestationByUserAndNetwork(...args),
  createBlockchainAttestation: (...args: unknown[]) =>
    mockCreateBlockchainAttestation(...args),
  getAttestationEvidenceByUserAndVerification: (...args: unknown[]) =>
    mockGetAttestationEvidenceByUserAndVerification(...args),
  resetBlockchainAttestation: (...args: unknown[]) =>
    mockResetBlockchainAttestation(...args),
  updateBlockchainAttestationSubmitted: (...args: unknown[]) =>
    mockUpdateBlockchainAttestationSubmitted(...args),
  updateBlockchainAttestationFailed: (...args: unknown[]) =>
    mockUpdateBlockchainAttestationFailed(...args),
  updateBlockchainAttestationConfirmed: (...args: unknown[]) =>
    mockUpdateBlockchainAttestationConfirmed(...args),
  updateBlockchainAttestationWallet: (...args: unknown[]) =>
    mockUpdateBlockchainAttestationWallet(...args),
  upsertAttestationEvidence: (...args: unknown[]) =>
    mockUpsertAttestationEvidence(...args),
  deleteBlockchainAttestationsByUserId: vi.fn(),
}));

vi.mock("@/lib/assurance/data", () => ({
  getSecurityPosture: (...args: unknown[]) => mockGetSecurityPosture(...args),
}));

vi.mock("@/lib/db/queries/identity", () => ({
  getVerificationStatus: (...args: unknown[]) =>
    mockGetVerificationStatus(...args),
  getSelectedVerification: (...args: unknown[]) =>
    mockGetSelectedVerification(...args),
  getIdentityBundleByUserId: (...args: unknown[]) =>
    mockGetIdentityBundleByUserId(...args),
}));

function createTier2Posture(): SecurityPosture {
  return {
    assurance: {
      tier: 2,
      tierName: "Verified",
      details: {
        isAuthenticated: true,
        hasSecuredKeys: true,
        chipVerified: false,
        documentVerified: true,
        livenessVerified: true,
        faceMatchVerified: true,
        zkProofsComplete: true,
        fheComplete: true,
        hasIncompleteProofs: false,
        missingProfileSecret: false,
        needsDocumentReprocessing: false,
        onChainAttested: false,
      },
    },
    auth: {
      id: "auth-context-1",
      loginMethod: "passkey",
      amr: ["pop", "hwk", "user"],
      authStrength: "strong",
      authenticatedAt: 1_700_000_000,
      sourceKind: "better_auth",
    },
    capabilities: {
      hasPasskeys: true,
      hasOpaqueAccount: true,
      hasWalletAuth: false,
    },
  };
}

function createTier1Posture(): SecurityPosture {
  return {
    assurance: {
      tier: 1,
      tierName: "Account",
      details: {
        isAuthenticated: true,
        hasSecuredKeys: true,
        chipVerified: false,
        documentVerified: false,
        livenessVerified: false,
        faceMatchVerified: false,
        zkProofsComplete: false,
        fheComplete: false,
        hasIncompleteProofs: false,
        missingProfileSecret: false,
        needsDocumentReprocessing: false,
        onChainAttested: false,
      },
    },
    auth: {
      id: "auth-context-2",
      loginMethod: "opaque",
      amr: ["pwd"],
      authStrength: "basic",
      authenticatedAt: 1_700_000_000,
      sourceKind: "better_auth",
    },
    capabilities: {
      hasPasskeys: false,
      hasOpaqueAccount: true,
      hasWalletAuth: false,
    },
  };
}

const authedSession = {
  user: { id: "test-user", twoFactorEnabled: true },
  session: { id: "test-session" },
} as unknown as Session;

const WALLET_A = "0x0000000000000000000000000000000000000001";
const WALLET_B = "0x0000000000000000000000000000000000000002";
const IDENTITY_REGISTRY = "0x00000000000000000000000000000000000000aa";
const TX_HASH = `0x${"1".repeat(64)}`;

function createPermit() {
  return {
    birthYearOffset: 25,
    countryCode: 840,
    complianceLevel: 3,
    isBlacklisted: false,
    proofSetHash: `0x${"0".repeat(64)}`,
    policyVersion: 1,
    deadline: 1_700_000_000,
    v: 27,
    r: `0x${"2".repeat(64)}`,
    s: `0x${"3".repeat(64)}`,
  };
}

function createIdentityData() {
  return {
    birthYearOffset: 25,
    countryCode: 840,
    complianceLevel: 3,
    isBlacklisted: false,
  };
}

function createProviderMock(overrides: Record<string, unknown> = {}) {
  return {
    getAttestationStatus: vi.fn().mockResolvedValue({ isAttested: false }),
    revokeAttestation: vi
      .fn()
      .mockResolvedValue({ status: "submitted", txHash: TX_HASH }),
    signPermit: vi.fn().mockResolvedValue({
      permit: createPermit(),
      identityData: createIdentityData(),
    }),
    checkTransaction: vi
      .fn()
      .mockResolvedValue({ confirmed: true, failed: false, blockNumber: 123 }),
    validateAttestationTransaction: vi.fn().mockResolvedValue("valid"),
    ...overrides,
  };
}

async function createCaller(session: Session | null) {
  const { attestationRouter } = await import("@/lib/trpc/routers/attestation");
  return attestationRouter.createCaller({
    req: new Request("http://localhost/api/trpc"),
    resHeaders: new Headers(),
    session,
    requestId: "test-request-id",
    flowId: null,
    flowIdSource: "none",
  });
}

describe("attestation router", () => {
  beforeAll(() => {
    vi.resetModules();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetEnabledNetworks.mockReturnValue([]);
    mockGetExplorerTxUrl.mockImplementation(
      (_networkId: string, txHash: string) =>
        `https://sepolia.etherscan.io/tx/${txHash}`
    );
    mockGetNetworkById.mockReturnValue({
      id: "fhevm_sepolia",
      name: "fhEVM (Sepolia)",
      chainId: 11_155_111,
      type: "fhevm",
      features: ["encrypted"],
      explorer: "https://sepolia.etherscan.io",
      contracts: { identityRegistry: IDENTITY_REGISTRY },
      enabled: true,
    });
    mockCanCreateProvider.mockReturnValue(true);
    mockCreateProvider.mockReturnValue(createProviderMock());
    mockGetBlockchainAttestationByUserAndNetwork.mockResolvedValue(null);
    mockGetAttestationEvidenceByUserAndVerification.mockResolvedValue(null);
    mockCreateBlockchainAttestation.mockResolvedValue({
      id: "att-1",
      userId: "test-user",
      walletAddress: WALLET_A,
      networkId: "fhevm_sepolia",
      chainId: 11_155_111,
      status: "pending",
      txHash: null,
      blockNumber: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      confirmedAt: null,
      revokedAt: null,
      errorMessage: null,
      retryCount: 0,
    });
    // Default to Tier 2 + strong auth for most tests (attestation requirement)
    mockGetSecurityPosture.mockResolvedValue(createTier2Posture());
    mockVerifyWalletOwnership.mockResolvedValue(true);
    mockGetIdentityBundleByUserId.mockResolvedValue({
      pepScreeningResult: "clear",
      sanctionsScreeningResult: "clear",
    });
    mockComputeProofSetHash.mockResolvedValue(null);
    // Default unified model for submit flow
    mockGetUnifiedVerificationModel.mockResolvedValue({
      method: "ocr",
      verificationId: "v-1",
      verifiedAt: "2026-01-01T00:00:00.000Z",
      issuerCountry: "USA",
      compliance: {
        level: "full",
        numericLevel: 3,
        verified: true,
        birthYearOffset: 25,
        checks: {
          documentVerified: true,
          livenessVerified: true,
          ageVerified: true,
          faceMatchVerified: true,
          nationalityVerified: true,
          identityBound: true,
          sybilResistant: true,
        },
      },
      checks: [],
      proofs: [],
      bundle: {
        exists: true,
        fheKeyId: "k-1",
        policyVersion: "v1",
        attestationExpiresAt: null,
        updatedAt: null,
      },
      fhe: { complete: true, attributeTypes: [] },
      vault: { hasProfileSecret: true },
      onChainAttested: false,
      needsDocumentReprocessing: false,
    });
  });

  it("returns networks with attestation status", async () => {
    mockGetEnabledNetworks.mockReturnValue([
      {
        id: "fhevm_sepolia",
        name: "fhEVM (Sepolia)",
        chainId: 11_155_111,
        type: "fhevm",
        features: ["encrypted"],
        explorer: "https://sepolia.etherscan.io",
        contracts: { identityRegistry: "0xABC" },
        enabled: true,
      },
    ]);
    mockGetBlockchainAttestationsByUserId.mockResolvedValue([]);

    const caller = await createCaller(authedSession);
    const result = await caller.networks();

    expect(result.networks).toHaveLength(1);
    expect(result.networks[0]?.id).toBe("fhevm_sepolia");
  });

  it("rejects submission when user lacks required tier", async () => {
    mockGetSecurityPosture.mockResolvedValue(createTier1Posture());

    const caller = await createCaller(authedSession);
    await expect(
      caller.createPermit({
        networkId: "fhevm_sepolia",
        walletAddress: WALLET_A,
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects submission when network is unavailable", async () => {
    mockGetVerificationStatus.mockReturnValue({
      verified: true,
      level: "full",
      numericLevel: 3,
      birthYearOffset: 25,
      checks: {
        documentVerified: true,
        livenessVerified: true,
        ageVerified: true,
        nationalityVerified: true,
        faceMatchVerified: true,
        identityBound: true,
        sybilResistant: true,
      },
    });
    mockGetSelectedVerification.mockReturnValue({
      id: "doc-1",
      status: "verified",
    });
    mockGetNetworkById.mockReturnValue({
      id: "fhevm_sepolia",
      enabled: false,
    });

    const caller = await createCaller(authedSession);
    await expect(
      caller.createPermit({
        networkId: "fhevm_sepolia",
        walletAddress: WALLET_A,
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("passes stored proofSetHash into signed permits and preserves it in evidence", async () => {
    const provider = createProviderMock();
    const proofSetHash = `0x${"a".repeat(64)}`;

    mockCreateProvider.mockReturnValue(provider);
    mockComputeProofSetHash.mockResolvedValue(proofSetHash);

    const caller = await createCaller(authedSession);
    await caller.createPermit({
      networkId: "fhevm_sepolia",
      walletAddress: WALLET_A,
    });

    expect(provider.signPermit).toHaveBeenCalledWith(
      expect.objectContaining({
        userAddress: WALLET_A,
        proofSetHash,
      })
    );
    expect(mockUpsertAttestationEvidence).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "test-user",
        verificationId: "v-1",
        proofSetHash,
      })
    );
  });

  it("syncs local state when the wallet is already attested on-chain", async () => {
    const provider = createProviderMock({
      getAttestationStatus: vi.fn().mockResolvedValue({
        isAttested: true,
        txHash: TX_HASH,
        blockNumber: 321,
      }),
    });
    mockCreateProvider.mockReturnValue(provider);

    const caller = await createCaller(authedSession);
    await expect(
      caller.createPermit({
        networkId: "fhevm_sepolia",
        walletAddress: WALLET_A,
      })
    ).resolves.toMatchObject({
      status: "confirmed",
      alreadyAttested: true,
      txHash: TX_HASH,
    });

    expect(mockCreateBlockchainAttestation).toHaveBeenCalledOnce();
    expect(mockUpdateBlockchainAttestationSubmitted).toHaveBeenCalledWith(
      "att-1",
      TX_HASH
    );
    expect(mockUpdateBlockchainAttestationConfirmed).toHaveBeenCalledWith(
      "att-1",
      321
    );
  });

  it("resets non-pending attestations before issuing a new permit", async () => {
    const provider = createProviderMock();
    mockCreateProvider.mockReturnValue(provider);
    mockGetBlockchainAttestationByUserAndNetwork.mockResolvedValue({
      id: "att-1",
      userId: "test-user",
      walletAddress: WALLET_A,
      networkId: "fhevm_sepolia",
      chainId: 11_155_111,
      status: "failed",
      txHash: TX_HASH,
      blockNumber: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      confirmedAt: null,
      revokedAt: null,
      errorMessage: "boom",
      retryCount: 1,
    });

    const caller = await createCaller(authedSession);
    await caller.createPermit({
      networkId: "fhevm_sepolia",
      walletAddress: WALLET_B,
    });

    expect(mockUpdateBlockchainAttestationWallet).toHaveBeenCalledWith(
      "att-1",
      WALLET_B,
      11_155_111
    );
    expect(mockResetBlockchainAttestation).toHaveBeenCalledWith("att-1");
  });

  it("rejects non-attestation transaction hashes during recordSubmission", async () => {
    const provider = createProviderMock({
      validateAttestationTransaction: vi.fn().mockResolvedValue("invalid"),
    });
    mockCreateProvider.mockReturnValue(provider);
    mockGetBlockchainAttestationByUserAndNetwork.mockResolvedValue({
      id: "att-1",
      userId: "test-user",
      walletAddress: WALLET_A,
      networkId: "fhevm_sepolia",
      chainId: 11_155_111,
      status: "pending",
      txHash: null,
      blockNumber: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      confirmedAt: null,
      revokedAt: null,
      errorMessage: null,
      retryCount: 0,
    });

    const caller = await createCaller(authedSession);
    await expect(
      caller.recordSubmission({
        networkId: "fhevm_sepolia",
        txHash: TX_HASH,
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    expect(mockUpdateBlockchainAttestationSubmitted).not.toHaveBeenCalled();
  });

  it("records fresh submissions while the server RPC is still indexing them", async () => {
    const provider = createProviderMock({
      validateAttestationTransaction: vi
        .fn()
        .mockResolvedValue("pending_lookup"),
    });
    mockCreateProvider.mockReturnValue(provider);
    mockGetBlockchainAttestationByUserAndNetwork.mockResolvedValue({
      id: "att-1",
      userId: "test-user",
      walletAddress: WALLET_A,
      networkId: "fhevm_sepolia",
      chainId: 11_155_111,
      status: "pending",
      txHash: null,
      blockNumber: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      confirmedAt: null,
      revokedAt: null,
      errorMessage: null,
      retryCount: 0,
    });

    const caller = await createCaller(authedSession);
    await expect(
      caller.recordSubmission({
        networkId: "fhevm_sepolia",
        txHash: TX_HASH,
      })
    ).resolves.toMatchObject({
      status: "submitted",
      txHash: TX_HASH,
      validationPending: true,
    });

    expect(mockUpdateBlockchainAttestationSubmitted).toHaveBeenCalledWith(
      "att-1",
      TX_HASH
    );
  });

  it("fails refresh when the receipt succeeds without an active attestation", async () => {
    const provider = createProviderMock({
      checkTransaction: vi.fn().mockResolvedValue({
        confirmed: true,
        failed: false,
        blockNumber: 456,
      }),
      getAttestationStatus: vi.fn().mockResolvedValue({ isAttested: false }),
    });
    mockCreateProvider.mockReturnValue(provider);
    mockGetBlockchainAttestationByUserAndNetwork.mockResolvedValue({
      id: "att-1",
      userId: "test-user",
      walletAddress: WALLET_A,
      networkId: "fhevm_sepolia",
      chainId: 11_155_111,
      status: "submitted",
      txHash: TX_HASH,
      blockNumber: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      confirmedAt: null,
      revokedAt: null,
      errorMessage: null,
      retryCount: 0,
    });

    const caller = await createCaller(authedSession);
    await expect(
      caller.refresh({
        networkId: "fhevm_sepolia",
      })
    ).resolves.toMatchObject({ status: "failed" });

    expect(mockUpdateBlockchainAttestationFailed).toHaveBeenCalledWith(
      "att-1",
      "Transaction confirmed without an active on-chain attestation"
    );
  });
});
