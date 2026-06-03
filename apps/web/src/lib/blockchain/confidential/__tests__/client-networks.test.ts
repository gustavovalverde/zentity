import { describe, expect, it } from "vitest";

import {
  buildConfidentialClientNetworks,
  buildConfidentialRelayerTransports,
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
    expect(
      hardhat?.mode === "cleartext" ? hardhat.cleartextConfig.network : null
    ).toBe("http://127.0.0.1:9545");
  });

  it("keeps relayer transports scoped to relayer-backed networks", () => {
    const networks = buildConfidentialClientNetworks({
      confidentialChainRpcUrl: "https://sepolia.example",
      localRpcUrl: "http://127.0.0.1:9545",
      relayerProxyUrl: "http://localhost:3000/api/confidential/relayer",
    });

    const transports = buildConfidentialRelayerTransports(networks);

    expect(transports[SEPOLIA_CONFIDENTIAL_CHAIN_ID]?.network).toBe(
      "https://sepolia.example"
    );
    expect(transports[SEPOLIA_CONFIDENTIAL_CHAIN_ID]?.relayerUrl).toBe(
      "http://localhost:3000/api/confidential/relayer"
    );
    expect(transports[HARDHAT_CONFIDENTIAL_CHAIN_ID]).toBeUndefined();
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
