import "server-only";

import { createPublicClient, http, isAddress } from "viem";

import { env } from "@/lib/env";

const IDENTITY_REGISTRY_ABI = [
  {
    inputs: [{ name: "user", type: "address" }],
    name: "isAttested",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

function getClient() {
  return createPublicClient({
    transport: http(env.CHAIN_RPC_URL),
  });
}

/**
 * Checks on-chain whether a wallet address has a valid attestation.
 * Returns null if registry is not configured, chain is unavailable,
 * or the address is invalid.
 */
export async function checkOnChainAttestation(
  walletAddress: string
): Promise<boolean | null> {
  const registry = env.IDENTITY_REGISTRY_ADDRESS;
  if (!registry) {
    return null;
  }

  if (!isAddress(walletAddress)) {
    return null;
  }

  try {
    const result = await getClient().readContract({
      address: registry as `0x${string}`,
      abi: IDENTITY_REGISTRY_ABI,
      functionName: "isAttested",
      args: [walletAddress as `0x${string}`],
    });
    return result;
  } catch (e) {
    console.warn("[x402] on-chain attestation check failed:", e);
    return null;
  }
}

export function getRegistryAddress(): string | null {
  return env.IDENTITY_REGISTRY_ADDRESS ?? null;
}
