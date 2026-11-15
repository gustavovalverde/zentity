import { hardhat, sepolia } from "viem/chains";
import { describe, expect, it } from "vitest";

import { createNetworkPublicClient, getViemChain } from "../networks";

describe("getViemChain", () => {
  it("resolves the supported chains", () => {
    expect(getViemChain(11_155_111)).toBe(sepolia);
    expect(getViemChain(31_337)).toBe(hardhat);
  });

  it("throws for an unsupported chain id", () => {
    expect(() => getViemChain(1)).toThrow("Unsupported chain ID: 1");
  });
});

describe("createNetworkPublicClient", () => {
  it("builds a client for the network chain", () => {
    const client = createNetworkPublicClient({
      chainId: 31_337,
      rpcUrl: "http://127.0.0.1:8545",
    });

    expect(client.chain.id).toBe(31_337);
  });

  it("throws for an unsupported chain id", () => {
    expect(() =>
      createNetworkPublicClient({ chainId: 1, rpcUrl: "http://x" })
    ).toThrow("Unsupported chain ID: 1");
  });
});
