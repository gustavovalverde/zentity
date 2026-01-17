// @vitest-environment jsdom

import type { FhevmProviderFactory } from "@/lib/privacy/fhe/providers/types";

import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useFhevmSdk } from "@/hooks/fhevm/use-fhevm-sdk";

const resolveMock = vi.fn();

vi.mock("@/lib/fhevm/providers/registry", () => ({
  resolveFhevmProviderFactory: (...args: unknown[]) => resolveMock(...args),
}));

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

    const provider = {
      request: vi.fn(async () => "0x7a69"), // 31337
    };

    const { result } = renderHook(() =>
      useFhevmSdk({
        provider,
        chainId: 31_337,
        providerId: "mock",
        initialMockChains: { 31337: "http://localhost:8545" },
      })
    );

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.instance).toBeTruthy();
  });

  it("errors when provider is not registered", async () => {
    resolveMock.mockReturnValue(undefined);

    const provider = {
      request: vi.fn(async () => "0xaa36a7"), // 11155111
    };

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

    const provider = {
      request: vi.fn(async () => "0xaa36a7"), // 11155111
    };

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

    const provider = {
      request: vi.fn(async () => "0x7a69"), // 31337
    };

    const { result } = renderHook(() =>
      useFhevmSdk({
        provider,
        chainId: 31_337,
        providerId: "zama",
        initialMockChains: { 31337: "http://localhost:8545" },
      })
    );

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(resolveMock).toHaveBeenCalledWith("mock");
  });
});
