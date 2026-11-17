import {
  createClient,
  custom,
  encodeFunctionResult,
  parseAbi,
  zeroHash,
} from "viem";
import { describe, expect, it, vi } from "vitest";

import {
  buildConfidentialClientNetworks,
  getConfidentialClientNetwork,
  HARDHAT_CONFIDENTIAL_CHAIN_ID,
  resolveHardhatFhevmChain,
  SEPOLIA_CONFIDENTIAL_CHAIN_ID,
} from "../client-networks";

const eip712DomainAbi = parseAbi([
  "function eip712Domain() view returns (bytes1 fields, string name, string version, uint256 chainId, address verifyingContract, bytes32 salt, uint256[] extensions)",
]);

const GATEWAY_CHAIN_ID = 100_733_346_448_153n;
const INPUT_VERIFICATION_CONTRACT =
  "0x6189F6c0c3E40B4a3c72ec86262295D78d845297";
const DECRYPTION_CONTRACT = "0xEaaA2FC6BC259dF015Aa7Dc8e59e0B67df622721";

function hardhatPreset() {
  const preset = getConfidentialClientNetwork(
    HARDHAT_CONFIDENTIAL_CHAIN_ID
  )?.chain;
  if (!preset) {
    throw new Error("Hardhat network missing");
  }
  return preset;
}

/** A client whose node answers `eip712Domain()` for the given verifiers. */
function verifierClient(
  domains: Record<string, readonly [string, `0x${string}`, bigint]>
) {
  const byAddress = new Map(
    Object.entries(domains).map(([address, domain]) => [
      address.toLowerCase(),
      domain,
    ])
  );
  const request = vi.fn(
    ({ method, params }: { method: string; params?: unknown }) => {
      const [call] = params as [{ to: string }];
      const domain = byAddress.get(call.to.toLowerCase());
      if (method !== "eth_call" || !domain) {
        throw new Error(`Unexpected ${method} to ${call.to}`);
      }
      const [name, verifyingContract, chainId] = domain;
      return Promise.resolve(
        encodeFunctionResult({
          abi: eip712DomainAbi,
          functionName: "eip712Domain",
          result: ["0x0f", name, "1", chainId, verifyingContract, zeroHash, []],
        })
      );
    }
  );
  return createClient({ transport: custom({ request }) });
}

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

  it("takes the Hardhat gateway domain from the node's verifiers", async () => {
    const preset = hardhatPreset();

    const chain = await resolveHardhatFhevmChain(
      preset,
      verifierClient({
        [preset.inputVerifierContractAddress]: [
          "InputVerification",
          INPUT_VERIFICATION_CONTRACT,
          GATEWAY_CHAIN_ID,
        ],
        [preset.kmsContractAddress]: [
          "Decryption",
          DECRYPTION_CONTRACT,
          GATEWAY_CHAIN_ID,
        ],
      })
    );

    expect(chain).toEqual({
      ...preset,
      gatewayChainId: Number(GATEWAY_CHAIN_ID),
      verifyingContractAddressDecryption: DECRYPTION_CONTRACT,
      verifyingContractAddressInputVerification: INPUT_VERIFICATION_CONTRACT,
    });
  });

  it("rejects a node whose verifiers name different gateway chains", async () => {
    const preset = hardhatPreset();

    await expect(
      resolveHardhatFhevmChain(
        preset,
        verifierClient({
          [preset.inputVerifierContractAddress]: [
            "InputVerification",
            INPUT_VERIFICATION_CONTRACT,
            GATEWAY_CHAIN_ID + 1n,
          ],
          [preset.kmsContractAddress]: [
            "Decryption",
            DECRYPTION_CONTRACT,
            GATEWAY_CHAIN_ID,
          ],
        })
      )
    ).rejects.toThrow("name different gateway chains");
  });

  it("explains how to recover when the node has no FHEVM stack", async () => {
    const preset = hardhatPreset();
    const request = vi.fn().mockResolvedValue("0x");

    await expect(
      resolveHardhatFhevmChain(
        preset,
        createClient({ transport: custom({ request }) })
      )
    ).rejects.toThrow("Start it from the contracts repository");
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
