import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { X402Resource } from "@/data/x402";

vi.mock("wagmi", () => ({
  useAccount: () => ({ isConnected: false, address: undefined }),
  useSwitchChain: () => ({ switchChainAsync: vi.fn() }),
}));
vi.mock("wagmi/actions", () => ({ getWalletClient: vi.fn() }));
vi.mock("@/lib/wagmi-config", () => ({ wagmiConfig: {} }));
vi.mock("@/lib/x402-client", () => ({ createX402PaymentClient: vi.fn() }));

import { useX402Flow } from "../use-x402-flow";

const RESOURCE: X402Resource = {
  id: "verified-identity",
  name: "Verified Identity",
  description: "Financial analytics",
  endpoint: "/api/analytics/market",
  icon: {} as X402Resource["icon"],
  price: "$0.000001",
  amount: "1",
  asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  eip712Name: "USDC",
  eip712Version: "2",
  network: "eip155:84532",
  payTo: "0x000000000000000000000000000000000000dEaD",
  requiredIdentityStrength: "documentary_full",
  requireOnChain: false,
  responseData: {},
};

const POH = {
  identity: { verified: true, strength: "documentary_full" },
  humanity: { proven: false },
  policy: { version: "v1.0" },
};

describe("useX402Flow", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        Response.json({ x402Version: 2, accepts: [] }, { status: 402 })
      )
      .mockResolvedValueOnce(Response.json({ access: "granted", poh: POH }));
  });

  afterEach(() => {
    vi.useRealTimers();
    fetchSpy.mockRestore();
  });

  // R37: the PoH token is obtained and checked by the merchant's server, so
  // the browser never fetches or sends it.
  it("never fetches or sends a Proof-of-Human token", async () => {
    const { result } = renderHook(() => useX402Flow());

    await act(async () => {
      const done = result.current.accessResource(RESOURCE);
      await vi.runAllTimersAsync();
      await done;
    });

    const calls = fetchSpy.mock.calls as [string, RequestInit][];
    expect(calls.map(([url]) => url)).toEqual([
      "/api/x402/access",
      "/api/x402/access",
    ]);
    for (const [, init] of calls) {
      const headers = new Headers(init.headers);
      expect(headers.has("Authorization")).toBe(false);
      expect(String(init.body)).not.toContain("poh");
    }
    expect(result.current.state).toBe("success");
    expect(result.current.pohClaims).toEqual(POH);
  });
});
