import { type FheChain, hardhat, sepolia } from "@zama-fhe/sdk/chains";

import { env } from "@/env";

const CONFIDENTIAL_RELAYER_PROXY_PATH = "/api/confidential/relayer";

export const HARDHAT_CONFIDENTIAL_CHAIN_ID = hardhat.id;
export const SEPOLIA_CONFIDENTIAL_CHAIN_ID = sepolia.id;

type ConfidentialClientNetwork =
  | {
      chain: FheChain;
      chainId: number;
      id: "hardhat";
      mode: "cleartext";
      name: string;
      rpcUrl: string;
    }
  | {
      chain: FheChain;
      chainId: number;
      id: "confidential_sepolia";
      mode: "relayer";
      name: string;
      rpcUrl: string;
    };

interface ConfidentialClientNetworkInput {
  confidentialChainRpcUrl: string;
  localRpcUrl: string;
  relayerProxyUrl: string;
}

type ConfidentialClientNetworks = Record<number, ConfidentialClientNetwork>;

function getRelayerProxyUrl() {
  if (globalThis.window === undefined) {
    return CONFIDENTIAL_RELAYER_PROXY_PATH;
  }
  return `${globalThis.window.location.origin}${CONFIDENTIAL_RELAYER_PROXY_PATH}`;
}

export function buildConfidentialClientNetworks({
  confidentialChainRpcUrl,
  localRpcUrl,
  relayerProxyUrl,
}: ConfidentialClientNetworkInput): ConfidentialClientNetworks {
  return {
    [sepolia.id]: {
      chain: {
        ...sepolia,
        network: confidentialChainRpcUrl,
        relayerUrl: relayerProxyUrl,
      },
      chainId: sepolia.id,
      id: "confidential_sepolia",
      mode: "relayer",
      name: "Zama Confidential Sepolia",
      rpcUrl: confidentialChainRpcUrl,
    },
    [hardhat.id]: {
      chain: {
        ...hardhat,
        // @fhevm/hardhat-plugin's mock deploys KMSVerifier at this address; remove when the preset and plugin agree.
        kmsContractAddress: "0xbE0E383937d564D7FF0BC3b46c51f0bF8d5C311A",
        network: localRpcUrl,
      },
      chainId: hardhat.id,
      id: "hardhat",
      mode: "cleartext",
      name: "Local (Hardhat)",
      rpcUrl: localRpcUrl,
    },
  };
}

function getConfidentialClientNetworks(): ConfidentialClientNetworks {
  return buildConfidentialClientNetworks({
    confidentialChainRpcUrl: env.NEXT_PUBLIC_CONFIDENTIAL_CHAIN_RPC_URL,
    localRpcUrl: env.NEXT_PUBLIC_LOCAL_RPC_URL,
    relayerProxyUrl: getRelayerProxyUrl(),
  });
}

export function getConfidentialClientNetwork(
  chainId: number,
  networks: ConfidentialClientNetworks = getConfidentialClientNetworks()
): ConfidentialClientNetwork | null {
  return networks[chainId] ?? null;
}
