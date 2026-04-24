import "server-only";

import {
  chainIdByNetwork,
  getIdentityRegistryMirrorAddress,
  identityRegistryMirrorAbi,
} from "@zentity/contracts";
import { createPublicClient, http, isAddress } from "viem";
import { baseSepolia } from "viem/chains";

import { env } from "@/lib/env";

const BASE_SEPOLIA_NETWORK = `eip155:${chainIdByNetwork.baseSepolia}`;

const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http(env.BASE_SEPOLIA_RPC_URL),
});

const configuredMirrorAddress: string | null = (() => {
  try {
    return env.BASE_SEPOLIA_IDENTITY_REGISTRY_MIRROR
      ? getIdentityRegistryMirrorAddress("baseSepolia", {
          overrides: {
            IdentityRegistryMirror: env.BASE_SEPOLIA_IDENTITY_REGISTRY_MIRROR,
          },
        })
      : getIdentityRegistryMirrorAddress("baseSepolia");
  } catch {
    return env.BASE_SEPOLIA_IDENTITY_REGISTRY_MIRROR ?? null;
  }
})();

export function getMirrorAddress(): string | null {
  return configuredMirrorAddress;
}

export async function readOnChainCompliance(
  walletAddress: string,
  minComplianceLevel: number
): Promise<{
  address: string;
  compliant: boolean;
  contract: string;
  minComplianceLevel: number;
  network: string;
} | null> {
  const mirrorAddress = configuredMirrorAddress;
  if (
    !(mirrorAddress && isAddress(mirrorAddress) && isAddress(walletAddress))
  ) {
    return null;
  }

  try {
    const compliant = await publicClient.readContract({
      address: mirrorAddress,
      abi: identityRegistryMirrorAbi,
      functionName: "isCompliant",
      args: [walletAddress, minComplianceLevel],
    });

    return {
      address: walletAddress,
      compliant: Boolean(compliant),
      contract: mirrorAddress,
      minComplianceLevel,
      network: BASE_SEPOLIA_NETWORK,
    };
  } catch {
    return null;
  }
}
