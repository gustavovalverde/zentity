import { describe, expect, it, vi } from "vitest";

import {
  buildConfidentialClientNetworks,
  getConfidentialClientNetwork,
  HARDHAT_CONFIDENTIAL_CHAIN_ID,
  resolveHardhatFhevmChain,
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

  it("takes Hardhat FHEVM addresses from the node's plugin metadata", async () => {
    const preset = getConfidentialClientNetwork(
      HARDHAT_CONFIDENTIAL_CHAIN_ID
    )?.chain;
    if (!preset) {
      throw new Error("Hardhat network missing");
    }
    const request = vi.fn().mockResolvedValue({
      ACLAddress: "0x50157CFfD6bBFA2DECe204a89ec419c23ef5755D",
      CoprocessorAddress: "0xe3a9105a3a932253A70F126eb1E3b589C643dD24",
      InputVerifierAddress: "0x36772142b74871f255CbD7A3e89B401d3e45825f",
      KMSVerifierAddress: "0xbE0E383937d564D7FF0BC3b46c51f0bF8d5C311A",
      chainId: 31_337,
      gatewayChainId: 10_901,
    });

    const chain = await resolveHardhatFhevmChain(preset, request);

    expect(request).toHaveBeenCalledWith({ method: "fhevm_relayer_metadata" });
    expect(chain).toMatchObject({
      aclContractAddress: "0x50157CFfD6bBFA2DECe204a89ec419c23ef5755D",
      executorAddress: "0xe3a9105a3a932253A70F126eb1E3b589C643dD24",
      gatewayChainId: 10_901,
      inputVerifierContractAddress:
        "0x36772142b74871f255CbD7A3e89B401d3e45825f",
      kmsContractAddress: "0xbE0E383937d564D7FF0BC3b46c51f0bF8d5C311A",
      network: preset.network,
    });
  });

  it("explains how to recover when the node has no FHEVM plugin", async () => {
    const preset = getConfidentialClientNetwork(
      HARDHAT_CONFIDENTIAL_CHAIN_ID
    )?.chain;
    if (!preset) {
      throw new Error("Hardhat network missing");
    }
    const request = vi
      .fn()
      .mockRejectedValue(new Error("Method fhevm_relayer_metadata not found"));

    await expect(resolveHardhatFhevmChain(preset, request)).rejects.toThrow(
      "Start it from the contracts repository"
    );
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
