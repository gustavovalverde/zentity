import type { SecurityPosture } from "@zentity/sdk/protocol";
import type { Session } from "@/lib/auth/auth-config";

import { parseUnits } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCanCreateProvider = vi.fn();
const mockCreateProvider = vi.fn();
const mockGetNetworkById = vi.fn();
const mockGetAttestation = vi.fn();
const mockGetSecurityPosture = vi.fn();
const { mockReadContract, mockWaitForReceipt } = vi.hoisted(() => ({
  mockReadContract: vi.fn(),
  mockWaitForReceipt: vi.fn(),
}));

vi.mock("viem", async () => {
  const actual = await vi.importActual<typeof import("viem")>("viem");

  return {
    ...actual,
    createPublicClient: vi.fn(() => ({
      readContract: mockReadContract,
      waitForTransactionReceipt: mockWaitForReceipt,
    })),
  };
});

vi.mock("@/lib/blockchain/networks", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/blockchain/networks")
  >("@/lib/blockchain/networks");

  return {
    ...actual,
    getEnabledNetworks: vi.fn(),
    getExplorerTxUrl: vi.fn(),
    getNetworkById: (...args: unknown[]) => mockGetNetworkById(...args),
  };
});

vi.mock("@/lib/assurance/posture", () => ({
  getSecurityPosture: (...args: unknown[]) => mockGetSecurityPosture(...args),
}));

vi.mock("@/lib/blockchain/attestation/providers", () => ({
  canCreateProvider: (...args: unknown[]) => mockCanCreateProvider(...args),
  createProvider: (...args: unknown[]) => mockCreateProvider(...args),
}));

vi.mock("@/lib/db/queries/attestation", () => ({
  getBlockchainAttestationByUserAndNetwork: (...args: unknown[]) =>
    mockGetAttestation(...args),
}));

const authedSession = {
  user: { id: "test-user" },
  session: { id: "test-session" },
} as unknown as Session;

async function createCaller(session: Session | null) {
  const { compliantTokenRouter } = await import(
    "@/lib/trpc/routers/compliant-token"
  );

  return compliantTokenRouter.createCaller({
    req: new Request("http://localhost/api/trpc"),
    session,
    requestId: "test-request-id",
    flowId: null,
    flowIdSource: "none",
  });
}

describe("compliantTokenRouter.isAttested", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCanCreateProvider.mockReturnValue(true);
    mockCreateProvider.mockReturnValue({
      getAttestationStatus: vi.fn().mockResolvedValue({ isAttested: true }),
    });
  });

  it("returns an attested status when the chain confirms the wallet", async () => {
    const caller = await createCaller(authedSession);

    await expect(
      caller.isAttested({
        networkId: "confidential_sepolia",
        address: "0x0000000000000000000000000000000000000001",
      })
    ).resolves.toEqual({
      isAttested: true,
      status: "attested",
    });
  });

  it("returns a not_attested status when the chain reports no attestation", async () => {
    mockCreateProvider.mockReturnValue({
      getAttestationStatus: vi.fn().mockResolvedValue({ isAttested: false }),
    });

    const caller = await createCaller(authedSession);

    await expect(
      caller.isAttested({
        networkId: "confidential_sepolia",
        address: "0x0000000000000000000000000000000000000001",
      })
    ).resolves.toEqual({
      isAttested: false,
      status: "not_attested",
    });
  });

  it("returns an unknown status when the provider is unavailable", async () => {
    mockCanCreateProvider.mockReturnValue(false);

    const caller = await createCaller(authedSession);

    await expect(
      caller.isAttested({
        networkId: "confidential_sepolia",
        address: "0x0000000000000000000000000000000000000001",
      })
    ).resolves.toEqual({
      isAttested: false,
      status: "unknown",
    });
  });

  it("returns an unknown status when the provider lookup fails", async () => {
    mockCreateProvider.mockRejectedValue(new Error("RPC unavailable"));

    const caller = await createCaller(authedSession);

    await expect(
      caller.isAttested({
        networkId: "confidential_sepolia",
        address: "0x0000000000000000000000000000000000000001",
      })
    ).resolves.toEqual({
      isAttested: false,
      status: "unknown",
    });
  });
});

const WALLET = "0x0000000000000000000000000000000000000001";
const TOKEN = "0x00000000000000000000000000000000000000bb";
const MINT_TX = `0x${"2".repeat(64)}`;
const UINT64_MAX = 2n ** 64n - 1n;

function strongTier2Posture(): SecurityPosture {
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

function networkWithChain(chainId: number) {
  return {
    id: "net",
    name: "Net",
    chainId,
    rpcUrl: "https://rpc.example",
    type: "confidential",
    features: ["encrypted"],
    contracts: {
      identityRegistry: "0x00000000000000000000000000000000000000aa",
      compliantERC20: TOKEN,
    },
    enabled: true,
  };
}

describe("compliantTokenRouter.mint", () => {
  const writeContract = vi.fn();
  let userSeq = 0;

  function session() {
    userSeq += 1;
    return {
      user: { id: `mint-user-${userSeq}` },
      session: { id: "test-session" },
    } as unknown as Session;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSecurityPosture.mockResolvedValue(strongTier2Posture());
    mockGetAttestation.mockResolvedValue({
      status: "confirmed",
      walletAddress: WALLET,
    });
    mockGetNetworkById.mockReturnValue(networkWithChain(31_337));
    mockCanCreateProvider.mockReturnValue(true);
    mockCreateProvider.mockReturnValue({
      getWalletClient: () => ({ writeContract }),
    });
    mockReadContract.mockResolvedValue(0n);
    writeContract.mockResolvedValue(MINT_TX);
    mockWaitForReceipt.mockResolvedValue({});
  });

  it("mints through the provider wallet client and waits for the receipt", async () => {
    const caller = await createCaller(session());

    await expect(
      caller.mint({
        networkId: "net",
        walletAddress: WALLET,
        amount: parseUnits("10", 18).toString(),
      })
    ).resolves.toEqual({ success: true, txHash: MINT_TX });
    expect(writeContract).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: "mint",
        args: [WALLET, parseUnits("10", 18)],
      })
    );
    expect(mockWaitForReceipt).toHaveBeenCalledWith({
      hash: MINT_TX,
      confirmations: 1,
    });
  });

  it("rejects amounts above the 10 token limit", async () => {
    const caller = await createCaller(session());

    await expect(
      caller.mint({
        networkId: "net",
        walletAddress: WALLET,
        amount: (parseUnits("10", 18) + 1n).toString(),
      })
    ).rejects.toThrow("Amount exceeds maximum mint limit (10 tokens)");
    expect(writeContract).not.toHaveBeenCalled();
  });

  it("rejects a mint that would exceed the euint64 supply cap", async () => {
    mockReadContract.mockResolvedValue(UINT64_MAX - 5n * 10n ** 18n);
    const caller = await createCaller(session());

    await expect(
      caller.mint({
        networkId: "net",
        walletAddress: WALLET,
        amount: parseUnits("6", 18).toString(),
      })
    ).rejects.toThrow(
      "Supply cap reached. Only 5.00 tokens can be minted (euint64 limit)."
    );
    expect(writeContract).not.toHaveBeenCalled();
  });

  it("throws for an unsupported chain instead of skipping the supply pre-check", async () => {
    mockGetNetworkById.mockReturnValue(networkWithChain(1337));
    const caller = await createCaller(session());

    await expect(
      caller.mint({ networkId: "net", walletAddress: WALLET, amount: "1" })
    ).rejects.toThrow("Unsupported chain ID: 1337");
    expect(mockReadContract).not.toHaveBeenCalled();
    expect(writeContract).not.toHaveBeenCalled();
  });
});
