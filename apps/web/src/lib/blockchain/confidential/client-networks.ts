import { HardhatConfig, SepoliaConfig } from "@zama-fhe/sdk";
import { hardhatCleartextConfig } from "@zama-fhe/sdk/cleartext";

import { env } from "@/env";

const CONFIDENTIAL_RELAYER_PROXY_PATH = "/api/confidential/relayer";

export const HARDHAT_CONFIDENTIAL_CHAIN_ID = HardhatConfig.chainId;
export const SEPOLIA_CONFIDENTIAL_CHAIN_ID = SepoliaConfig.chainId;

type ConfidentialRelayerTransport = Omit<
  typeof SepoliaConfig,
  "network" | "relayerUrl"
> & {
  network: string;
  relayerUrl: string;
};

type ConfidentialCleartextConfig = Omit<
  typeof hardhatCleartextConfig,
  "network"
> & {
  network: string;
};

type ConfidentialClientNetwork =
  | {
      chainId: number;
      cleartextConfig: ConfidentialCleartextConfig;
      id: "hardhat";
      mode: "cleartext";
      name: string;
      rpcUrl: string;
    }
  | {
      chainId: number;
      id: "confidential_sepolia";
      mode: "relayer";
      name: string;
      relayerUrl: string;
      rpcUrl: string;
      transport: ConfidentialRelayerTransport;
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
    [SepoliaConfig.chainId]: {
      chainId: SepoliaConfig.chainId,
      id: "confidential_sepolia",
      mode: "relayer",
      name: "Zama Confidential Sepolia",
      relayerUrl: relayerProxyUrl,
      rpcUrl: confidentialChainRpcUrl,
      transport: {
        ...SepoliaConfig,
        network: confidentialChainRpcUrl,
        relayerUrl: relayerProxyUrl,
      },
    },
    [HardhatConfig.chainId]: {
      chainId: HardhatConfig.chainId,
      cleartextConfig: {
        ...hardhatCleartextConfig,
        network: localRpcUrl,
      },
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

export function buildConfidentialRelayerTransports(
  networks: ConfidentialClientNetworks = getConfidentialClientNetworks()
): Record<number, ConfidentialRelayerTransport> {
  return Object.fromEntries(
    Object.values(networks)
      .filter((network) => network.mode === "relayer")
      .map((network) => [network.chainId, network.transport])
  );
}
