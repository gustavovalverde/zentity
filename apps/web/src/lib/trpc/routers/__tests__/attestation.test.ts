/**
 * Integration tests for attestation router (demo + error flows).
 */

import type { Session } from "@/lib/auth/auth";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockIsDemoMode = vi.fn();
const mockGetEnabledNetworks = vi.fn();
const mockGetNetworkById = vi.fn();
const mockCanCreateProvider = vi.fn();
const mockCreateProvider = vi.fn();
const mockGetExplorerTxUrl = vi.fn();

vi.mock("@/lib/blockchain", () => ({
  isDemoMode: () => mockIsDemoMode(),
  getEnabledNetworks: (...args: unknown[]) => mockGetEnabledNetworks(...args),
  getNetworkById: (...args: unknown[]) => mockGetNetworkById(...args),
  canCreateProvider: (...args: unknown[]) => mockCanCreateProvider(...args),
  createProvider: (...args: unknown[]) => mockCreateProvider(...args),
  getExplorerTxUrl: (...args: unknown[]) => mockGetExplorerTxUrl(...args),
}));

const mockGetVerificationStatus = vi.fn();
const mockGetSelectedIdentityDocumentByUserId = vi.fn();
const mockGetBlockchainAttestationsByUserId = vi.fn();
const mockGetBlockchainAttestationByUserAndNetwork = vi.fn();
const mockCreateBlockchainAttestation = vi.fn();
const mockResetBlockchainAttestationForRetry = vi.fn();
const mockUpdateBlockchainAttestationSubmitted = vi.fn();
const mockUpdateBlockchainAttestationFailed = vi.fn();
const mockUpdateBlockchainAttestationConfirmed = vi.fn();

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  return {
    ...actual,
    getVerificationStatus: (...args: unknown[]) =>
      mockGetVerificationStatus(...args),
    getSelectedIdentityDocumentByUserId: (...args: unknown[]) =>
      mockGetSelectedIdentityDocumentByUserId(...args),
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
  };
});

const authedSession = {
  user: { id: "test-user" },
  session: { id: "test-session" },
} as unknown as Session;

async function createCaller(session: Session | null) {
  const { attestationRouter } = await import("@/lib/trpc/routers/attestation");
  return attestationRouter.createCaller({
    req: new Request("http://localhost/api/trpc"),
    session,
    requestId: "test-request-id",
  });
}

describe("attestation router", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
        chainId: 11155111,
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
    });
    await vi.runAllTimersAsync();
    const result = await promise;
    vi.useRealTimers();

    expect(result.demo).toBe(true);
    expect(result.status).toBe("confirmed");
    expect(result.txHash?.startsWith("0xdemo")).toBe(true);
  });

  it("rejects submission when user is not verified", async () => {
    mockIsDemoMode.mockReturnValue(false);
    mockGetVerificationStatus.mockReturnValue({
      verified: false,
      level: "none",
      checks: {
        document: false,
        liveness: false,
        ageProof: false,
        docValidityProof: false,
        nationalityProof: false,
        faceMatchProof: false,
      },
    });

    const caller = await createCaller(authedSession);
    await expect(
      caller.submit({
        networkId: "fhevm_sepolia",
        walletAddress: "0x0000000000000000000000000000000000000001",
      }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
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
      birthYearOffset: 90,
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
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
