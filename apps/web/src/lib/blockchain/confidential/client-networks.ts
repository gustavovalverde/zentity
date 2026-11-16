import { type FheChain, hardhat, sepolia } from "@zama-fhe/sdk/chains";
import { type EIP1193RequestFn, isAddress } from "viem";
import { z } from "zod";

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
      chain: { ...hardhat, network: localRpcUrl },
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

const fhevmAddressSchema = z
  .string()
  .refine((value) => isAddress(value), "Invalid address")
  .transform((value) => value as `0x${string}`);

const hardhatFhevmMetadataSchema = z.object({
  ACLAddress: fhevmAddressSchema,
  CoprocessorAddress: fhevmAddressSchema,
  InputVerifierAddress: fhevmAddressSchema,
  KMSVerifierAddress: fhevmAddressSchema,
  gatewayChainId: z.number().int(),
});

/**
 * Points the Hardhat preset at the contracts the local node deployed.
 *
 * The `@fhevm/hardhat-plugin` mock reports its addresses through the
 * `fhevm_relayer_metadata` RPC method. They drift from the SDK's `hardhat`
 * preset between releases: plugin 0.3 and 0.4 deploy KMSVerifier at the
 * Sepolia address, not the preset's.
 */
export async function resolveHardhatFhevmChain(
  chain: FheChain,
  request: EIP1193RequestFn
): Promise<FheChain> {
  let metadata: z.infer<typeof hardhatFhevmMetadataSchema>;
  try {
    metadata = hardhatFhevmMetadataSchema.parse(
      await request({ method: "fhevm_relayer_metadata" })
    );
  } catch (cause) {
    throw new Error(
      "The local Hardhat node did not report its FHEVM contracts. Start it from the contracts repository with the FHEVM Hardhat plugin, then reload this page.",
      { cause }
    );
  }
  return {
    ...chain,
    aclContractAddress: metadata.ACLAddress,
    executorAddress: metadata.CoprocessorAddress,
    gatewayChainId: metadata.gatewayChainId,
    inputVerifierContractAddress: metadata.InputVerifierAddress,
    kmsContractAddress: metadata.KMSVerifierAddress,
  };
}
