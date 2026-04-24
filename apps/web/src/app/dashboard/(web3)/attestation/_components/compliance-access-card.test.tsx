// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ATTR, Purpose } from "@zentity/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

const appKitMocks = vi.hoisted(() => ({
  address: "0x0000000000000000000000000000000000000001",
}));

const wagmiMocks = vi.hoisted(() => ({
  chainId: 31_337,
  refetchBalance: vi.fn().mockResolvedValue({
    data: { value: BigInt(1) },
  }),
  resetWrite: vi.fn(),
  switchChain: vi.fn(),
  writeContractAsync: vi.fn().mockResolvedValue("0xhash"),
}));

const faucetMocks = vi.hoisted(() => ({
  faucet: vi.fn(),
}));

vi.mock("@reown/appkit/react", () => ({
  useAppKitAccount: () => ({
    address: appKitMocks.address,
  }),
}));

vi.mock("wagmi", () => ({
  useBalance: () => ({
    data: { value: BigInt(1) },
    refetch: wagmiMocks.refetchBalance,
    isLoading: false,
  }),
  useChainId: () => wagmiMocks.chainId,
  useSwitchChain: () => ({
    mutate: wagmiMocks.switchChain,
    isPending: false,
  }),
  useWaitForTransactionReceipt: () => ({
    isLoading: false,
    isSuccess: false,
    error: null,
  }),
  useWriteContract: () => ({
    data: undefined,
    mutateAsync: wagmiMocks.writeContractAsync,
    isPending: false,
    error: null,
    reset: wagmiMocks.resetWrite,
  }),
}));

vi.mock("@/lib/blockchain/wagmi", () => ({
  useDevFaucet: () => ({
    faucet: faucetMocks.faucet,
    isFauceting: false,
    error: null,
    isSupported: false,
  }),
}));

describe("ComplianceAccessCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes the selected purpose to grantAttributeAccess", async () => {
    const { ComplianceAccessCard } = await import("./compliance-access-card");

    render(
      <ComplianceAccessCard
        complianceRules={"0x00000000000000000000000000000000000000cc"}
        identityRegistry={"0x00000000000000000000000000000000000000aa"}
        isGranted={false}
        onGranted={vi.fn()}
      />
    );

    fireEvent.change(screen.getByLabelText("Grant purpose"), {
      target: { value: String(Purpose.AUDIT) },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Grant Compliance Access" })
    );

    // biome-ignore lint/suspicious/noBitwiseOperators: attribute bitmask is intentional in the contract call.
    const attributeMask = ATTR.COMPLIANCE | ATTR.BLACKLIST;

    await waitFor(() => {
      expect(wagmiMocks.writeContractAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          args: [
            "0x00000000000000000000000000000000000000cc",
            attributeMask,
            Purpose.AUDIT,
          ],
        })
      );
    });
  });

  it("renders all supported on-chain purpose options", async () => {
    const { ComplianceAccessCard } = await import("./compliance-access-card");

    render(
      <ComplianceAccessCard
        complianceRules={"0x00000000000000000000000000000000000000cc"}
        identityRegistry={"0x00000000000000000000000000000000000000aa"}
        isGranted={false}
        onGranted={vi.fn()}
      />
    );

    const purposeSelect = screen.getByLabelText("Grant purpose");
    const optionValues = Array.from(
      purposeSelect.querySelectorAll("option")
    ).map((option) => option.getAttribute("value"));

    expect(optionValues).toEqual([
      String(Purpose.COMPLIANCE_CHECK),
      String(Purpose.AGE_VERIFICATION),
      String(Purpose.NATIONALITY_CHECK),
      String(Purpose.TRANSFER_GATING),
      String(Purpose.AUDIT),
    ]);
  });
});
