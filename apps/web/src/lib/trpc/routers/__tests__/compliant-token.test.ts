import type { Session } from "@/lib/auth/auth-config";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCanCreateProvider = vi.fn();
const mockCreateProvider = vi.fn();

vi.mock("@/lib/blockchain/networks", () => ({
  getEnabledNetworks: vi.fn(),
  getExplorerTxUrl: vi.fn(),
  getNetworkById: vi.fn(),
}));

vi.mock("@/lib/blockchain/attestation/providers", () => ({
  canCreateProvider: (...args: unknown[]) => mockCanCreateProvider(...args),
  createProvider: (...args: unknown[]) => mockCreateProvider(...args),
}));

vi.mock("@/lib/db/queries/attestation", () => ({
  getBlockchainAttestationByUserAndNetwork: vi.fn(),
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
    resHeaders: new Headers(),
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
    mockCreateProvider.mockResolvedValue({
      getAttestationStatus: vi.fn().mockResolvedValue({ isAttested: true }),
    });
  });

  it("returns an attested status when the chain confirms the wallet", async () => {
    const caller = await createCaller(authedSession);

    await expect(
      caller.isAttested({
        networkId: "fhevm_sepolia",
        address: "0x0000000000000000000000000000000000000001",
      })
    ).resolves.toEqual({
      isAttested: true,
      status: "attested",
    });
  });

  it("returns a not_attested status when the chain reports no attestation", async () => {
    mockCreateProvider.mockResolvedValue({
      getAttestationStatus: vi.fn().mockResolvedValue({ isAttested: false }),
    });

    const caller = await createCaller(authedSession);

    await expect(
      caller.isAttested({
        networkId: "fhevm_sepolia",
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
        networkId: "fhevm_sepolia",
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
        networkId: "fhevm_sepolia",
        address: "0x0000000000000000000000000000000000000001",
      })
    ).resolves.toEqual({
      isAttested: false,
      status: "unknown",
    });
  });
});
