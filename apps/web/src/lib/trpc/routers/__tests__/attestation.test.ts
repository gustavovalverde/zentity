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
const mockResetBlockchainAttestationForRetry = vi.fn();
const mockUpdateBlockchainAttestationSubmitted = vi.fn();
const mockUpdateBlockchainAttestationFailed = vi.fn();
const mockUpdateBlockchainAttestationConfirmed = vi.fn();
const mockUpdateBlockchainAttestationWallet = vi.fn();
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

vi.mock("@/lib/db/queries/identity", () => ({
  getVerificationStatus: (...args: unknown[]) =>
    mockGetVerificationStatus(...args),
  getSelectedVerification: (...args: unknown[]) =>
    mockGetSelectedVerification(...args),
}));

const mockGetUnifiedVerificationModel = vi.fn();
vi.mock("@/lib/identity/verification/unified-model", () => ({
  getUnifiedVerificationModel: (...args: unknown[]) =>
    mockGetUnifiedVerificationModel(...args),
}));

vi.mock("@/lib/db/queries/attestation", () => ({
  getBlockchainAttestationsByUserId: (...args: unknown[]) =>
    mockGetBlockchainAttestationsByUserId(...args),
  getBlockchainAttestationByUserAndNetwork: (...args: unknown[]) =>
    mockGetBlockchainAttestationByUserAndNetwork(...args),
  createBlockchainAttestation: (...args: unknown[]) =>
    mockCreateBlockchainAttestation(...args),
  resetBlockchainAttestationForRetry: (...args: unknown[]) =>
    mockResetBlockchainAttestationForRetry(...args),
  updateBlockchainAttestationSubmitted: (...args: unknown[]) =>
    mockUpdateBlockchainAttestationSubmitted(...args),
  updateBlockchainAttestationFailed: (...args: unknown[]) =>
    mockUpdateBlockchainAttestationFailed(...args),
  updateBlockchainAttestationConfirmed: (...args: unknown[]) =>
    mockUpdateBlockchainAttestationConfirmed(...args),
  updateBlockchainAttestationWallet: (...args: unknown[]) =>
    mockUpdateBlockchainAttestationWallet(...args),
  updateBlockchainAttestationRevoked: vi.fn(),
  upsertAttestationEvidence: vi.fn(),
  getAttestationEvidenceByUserAndVerification: vi.fn(),
  deleteBlockchainAttestationsByUserId: vi.fn(),
}));

vi.mock("@/lib/assurance/data", () => ({
  getSecurityPosture: (...args: unknown[]) => mockGetSecurityPosture(...args),
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
    // Default to Tier 2 + strong auth for most tests (attestation requirement)
    mockGetSecurityPosture.mockResolvedValue(createTier2Posture());
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
      caller.submit({
        networkId: "fhevm_sepolia",
        walletAddress: "0x0000000000000000000000000000000000000001",
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
      caller.submit({
        networkId: "fhevm_sepolia",
        walletAddress: "0x0000000000000000000000000000000000000001",
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
