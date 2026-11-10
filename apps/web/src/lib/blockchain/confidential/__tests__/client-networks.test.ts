import { describe, expect, it } from "vitest";

import {
  buildConfidentialClientNetworks,
  getConfidentialClientNetwork,
  HARDHAT_CONFIDENTIAL_CHAIN_ID,
  SEPOLIA_CONFIDENTIAL_CHAIN_ID,
} from "../client-networks";

describe("confidential client networks", () => {
  it("uses the configured local RPC URL for Hardhat cleartext mode", () => {
    const networks = buildConfidentialClientNetworks({
      confidentialChainRpcUrl: "https://sepolia.example",
      localRpcUrl: "http://127.0.0.1:9545",
      relayerProxyUrl: "http://localhost:3000/api/confidential/relayer",
    });

    const hardhat = getConfidentialClientNetwork(
      HARDHAT_CONFIDENTIAL_CHAIN_ID,
      networks
    );

    expect(hardhat?.mode).toBe("cleartext");
    expect(hardhat?.rpcUrl).toBe("http://127.0.0.1:9545");
    expect(hardhat?.chain.network).toBe("http://127.0.0.1:9545");
  });

  it("routes Sepolia through the relayer proxy with the configured RPC", () => {
    const networks = buildConfidentialClientNetworks({
      confidentialChainRpcUrl: "https://sepolia.example",
      localRpcUrl: "http://127.0.0.1:9545",
      relayerProxyUrl: "http://localhost:3000/api/confidential/relayer",
    });

    const sepolia = getConfidentialClientNetwork(
      SEPOLIA_CONFIDENTIAL_CHAIN_ID,
      networks
    );

    expect(sepolia?.mode).toBe("relayer");
    expect(sepolia?.chain.network).toBe("https://sepolia.example");
    expect(sepolia?.chain.relayerUrl).toBe(
      "http://localhost:3000/api/confidential/relayer"
    );
  });

  it("does not silently map unsupported chains to Sepolia", () => {
    const networks = buildConfidentialClientNetworks({
      confidentialChainRpcUrl: "https://sepolia.example",
      localRpcUrl: "http://127.0.0.1:9545",
      relayerProxyUrl: "http://localhost:3000/api/confidential/relayer",
    });

    expect(getConfidentialClientNetwork(1, networks)).toBeNull();
  });
});
