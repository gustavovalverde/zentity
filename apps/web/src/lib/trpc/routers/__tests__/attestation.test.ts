/**
 * Integration tests for attestation router (demo + error flows).
 */

import type { AssuranceState } from "@/lib/assurance/types";
import type { Session } from "@/lib/auth/auth";

import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const mockIsDemoMode = vi.fn();
const mockGetEnabledNetworks = vi.fn();
const mockGetNetworkById = vi.fn();
const mockCanCreateProvider = vi.fn();
const mockCreateProvider = vi.fn();
const mockGetExplorerTxUrl = vi.fn();
const mockGetVerificationStatus = vi.fn();
const mockGetSelectedIdentityDocumentByUserId = vi.fn();
const mockGetBlockchainAttestationsByUserId = vi.fn();
const mockGetBlockchainAttestationByUserAndNetwork = vi.fn();
const mockCreateBlockchainAttestation = vi.fn();
const mockResetBlockchainAttestationForRetry = vi.fn();
const mockUpdateBlockchainAttestationSubmitted = vi.fn();
const mockUpdateBlockchainAttestationFailed = vi.fn();
const mockUpdateBlockchainAttestationConfirmed = vi.fn();
const mockUpdateBlockchainAttestationWallet = vi.fn();
const mockGetAssuranceState = vi.fn();

// All mocks must be hoisted before any imports
vi.mock("@/lib/blockchain/networks", () => ({
  isDemoMode: () => mockIsDemoMode(),
  getEnabledNetworks: (...args: unknown[]) => mockGetEnabledNetworks(...args),
  getNetworkById: (...args: unknown[]) => mockGetNetworkById(...args),
  getExplorerTxUrl: (...args: unknown[]) => mockGetExplorerTxUrl(...args),
}));

vi.mock("@/lib/blockchain/providers/factory", () => ({
  canCreateProvider: (...args: unknown[]) => mockCanCreateProvider(...args),
  createProvider: (...args: unknown[]) => mockCreateProvider(...args),
}));

vi.mock("@/lib/db/queries/identity", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/db/queries/identity")>();
  return {
    ...actual,
    getVerificationStatus: (...args: unknown[]) =>
      mockGetVerificationStatus(...args),
    getSelectedIdentityDocumentByUserId: (...args: unknown[]) =>
      mockGetSelectedIdentityDocumentByUserId(...args),
  };
});

vi.mock("@/lib/db/queries/attestation", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/db/queries/attestation")>();
  return {
    ...actual,
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
  };
});

vi.mock("@/lib/assurance/data", () => ({
  getAssuranceState: (...args: unknown[]) => mockGetAssuranceState(...args),
}));

function createTier2State(): AssuranceState {
  return {
    tier: 2,
    tierName: "Verified",
    authStrength: "strong",
    loginMethod: "passkey",
    details: {
      isAuthenticated: true,
      hasSecuredKeys: true,
      documentVerified: true,
      livenessVerified: true,
      faceMatchVerified: true,
      zkProofsComplete: true,
      fheComplete: true,
      hasIncompleteProofs: false,
      onChainAttested: false,
    },
  };
}

function createTier1State(): AssuranceState {
  return {
    tier: 1,
    tierName: "Account",
    authStrength: "basic",
    loginMethod: "opaque",
    details: {
      isAuthenticated: true,
      hasSecuredKeys: true,
      documentVerified: false,
      livenessVerified: false,
      faceMatchVerified: false,
      zkProofsComplete: false,
      fheComplete: false,
      hasIncompleteProofs: false,
      onChainAttested: false,
    },
  };
}

const authedSession = {
  user: { id: "test-user", twoFactorEnabled: true },
  session: { id: "test-session", lastLoginMethod: "passkey" },
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
    mockGetAssuranceState.mockResolvedValue(createTier2State());
  });

  afterEach(() => {
    mockIsDemoMode.mockReset();
  });

  it("returns demo networks when demo mode is enabled", async () => {
    mockIsDemoMode.mockReturnValue(true);
    mockGetEnabledNetworks.mockReturnValue([
      {
        id: "demo_fhevm",
        name: "fhEVM Demo",
        chainId: 11_155_111,
        type: "fhevm",
        features: ["encrypted"],
        explorer: "https://sepolia.etherscan.io",
        contracts: { identityRegistry: "0xDemo" },
        enabled: true,
      },
    ]);

    const caller = await createCaller(authedSession);
    const result = await caller.networks();

    expect(result.demo).toBe(true);
    expect(result.networks).toHaveLength(1);
    expect(result.networks[0]?.id).toBe("demo_fhevm");
  });

  it("returns demo submission when demo mode is enabled", async () => {
    mockIsDemoMode.mockReturnValue(true);
    const caller = await createCaller(authedSession);

    vi.useFakeTimers();
    const promise = caller.submit({
      networkId: "demo_fhevm",
      walletAddress: "0x0000000000000000000000000000000000000001",
      birthYearOffset: 90,
    });
    await vi.runAllTimersAsync();
    const result = await promise;
    vi.useRealTimers();

    expect(result.demo).toBe(true);
    expect(result.status).toBe("confirmed");
    expect(result.txHash?.startsWith("0xdemo")).toBe(true);
  });

  it("rejects submission when user lacks required tier", async () => {
    // User at Tier 1 trying to access attestation (requires Tier 2 + strong auth)
    mockGetAssuranceState.mockResolvedValue(createTier1State());

    const caller = await createCaller(authedSession);
    await expect(
      caller.submit({
        networkId: "fhevm_sepolia",
        walletAddress: "0x0000000000000000000000000000000000000001",
        birthYearOffset: 90,
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects submission when network is unavailable", async () => {
    mockIsDemoMode.mockReturnValue(false);
    mockGetVerificationStatus.mockReturnValue({
      verified: true,
      level: "full",
      checks: {
        document: true,
        liveness: true,
        ageProof: true,
        docValidityProof: true,
        nationalityProof: true,
        faceMatchProof: true,
      },
    });
    mockGetSelectedIdentityDocumentByUserId.mockReturnValue({
      issuerCountry: "USA",
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
        birthYearOffset: 90,
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
