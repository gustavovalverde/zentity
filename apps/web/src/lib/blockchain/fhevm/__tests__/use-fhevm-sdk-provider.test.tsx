// @vitest-environment jsdom

import type { FhevmProviderFactory } from "@/lib/blockchain/fhevm/provider-registry";

import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useFhevmSdk } from "@/lib/blockchain/fhevm/use-fhevm-sdk";

const resolveMock = vi.fn();

vi.mock("@/lib/blockchain/fhevm/provider-registry", () => ({
  resolveFhevmProviderFactory: (...args: unknown[]) => resolveMock(...args),
}));

// Stable references — the hook's refresh callback depends on these, so fresh
// object literals on every render would cause an infinite re-render loop.
const HARDHAT_MOCK_CHAINS = { 31337: "http://localhost:8545" } as const;
const HARDHAT_PROVIDER_RESPONSE = "0x7a69"; // chainId 31337
const SEPOLIA_PROVIDER_RESPONSE = "0xaa36a7"; // chainId 11155111

function makeProvider(chainIdHex: string) {
  return { request: vi.fn(async () => chainIdHex) };
}

describe("useFhevmSdk provider selection", () => {
  beforeEach(() => {
    resolveMock.mockReset();
  });

  it("uses mock provider when providerId=mock", async () => {
    const factory: FhevmProviderFactory = (params) => {
      expect(params.rpcUrl).toBe("http://localhost:8545");
      return Promise.resolve({ createEncryptedInput: () => ({}) } as never);
    };
    resolveMock.mockReturnValue(factory);

    const provider = makeProvider(HARDHAT_PROVIDER_RESPONSE);

    const { result } = renderHook(() =>
      useFhevmSdk({
        provider,
        chainId: 31_337,
        providerId: "mock",
        initialMockChains: HARDHAT_MOCK_CHAINS,
      })
    );

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.instance).toBeTruthy();
  });

  it("errors when provider is not registered", async () => {
    resolveMock.mockReturnValue(undefined);

    const provider = makeProvider(SEPOLIA_PROVIDER_RESPONSE);

    const { result } = renderHook(() =>
      useFhevmSdk({
        provider,
        chainId: 11_155_111,
        providerId: "zama",
      })
    );

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error?.message).toContain(
      "FHEVM provider not registered"
    );
  });

  it("uses zama provider on non-mock chain", async () => {
    const factory: FhevmProviderFactory = (params) => {
      expect(params.chainId).toBe(11_155_111);
      return Promise.resolve({ createEncryptedInput: () => ({}) } as never);
    };
    resolveMock.mockReturnValue(factory);

    const provider = makeProvider(SEPOLIA_PROVIDER_RESPONSE);

    const { result } = renderHook(() =>
      useFhevmSdk({
        provider,
        chainId: 11_155_111,
        providerId: "zama",
      })
    );

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.instance).toBeTruthy();
  });

  it("falls back to mock provider on hardhat even when zama requested", async () => {
    const factory: FhevmProviderFactory = (params) => {
      expect(params.rpcUrl).toBe("http://localhost:8545");
      return Promise.resolve({ createEncryptedInput: () => ({}) } as never);
    };
    resolveMock.mockReturnValue(factory);

    const provider = makeProvider(HARDHAT_PROVIDER_RESPONSE);

    const { result } = renderHook(() =>
      useFhevmSdk({
        provider,
        chainId: 31_337,
        providerId: "zama",
        initialMockChains: HARDHAT_MOCK_CHAINS,
      })
    );

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(resolveMock).toHaveBeenCalledWith("mock");
  });
});
