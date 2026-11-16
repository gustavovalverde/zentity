// @vitest-environment jsdom

import type { ReactNode } from "react";

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const walletMocks = vi.hoisted(() => ({
  signMessage: vi.fn(),
  signTypedData: vi.fn(),
}));

const authClientMocks = vi.hoisted(() => ({
  getSession: vi.fn().mockResolvedValue({ data: null }),
  signIn: vi.fn(),
}));

vi.mock("@reown/appkit/react", () => ({
  createAppKit: vi.fn(),
  useAppKit: () => ({ open: vi.fn() }),
  useAppKitAccount: () => ({
    address: "0x0000000000000000000000000000000000000001",
    isConnected: true,
  }),
}));

vi.mock("wagmi", () => ({
  cookieToInitialState: () => undefined,
  useChainId: () => 1,
  useSignMessage: () => ({ mutateAsync: walletMocks.signMessage }),
  useSignTypedData: () => ({ mutateAsync: walletMocks.signTypedData }),
  WagmiProvider: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
}));

vi.mock("@/lib/blockchain/wagmi", () => ({
  confidentialSepolia: {},
  networks: [],
  projectId: undefined,
  wagmiAdapter: { wagmiConfig: {} },
}));

vi.mock("@/lib/blockchain/confidential/chain", () => ({
  ConfidentialChainProvider: ({ children }: { children: ReactNode }) =>
    children,
}));

vi.mock("@/lib/auth/auth-client", () => ({
  authClient: {
    getSession: authClientMocks.getSession,
    signIn: new Proxy(
      {},
      {
        get: (_target, method) => () => authClientMocks.signIn(method),
      }
    ),
  },
}));

import { Web3Provider } from "../web3-provider";

describe("Web3Provider", () => {
  it("does not ask a connected wallet to sign in on its own", async () => {
    render(
      <Web3Provider cookies={null}>
        <p>page</p>
      </Web3Provider>
    );
    await screen.findByText("page");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(authClientMocks.getSession).not.toHaveBeenCalled();
    expect(authClientMocks.signIn).not.toHaveBeenCalled();
    expect(walletMocks.signMessage).not.toHaveBeenCalled();
    expect(walletMocks.signTypedData).not.toHaveBeenCalled();
  });
});
