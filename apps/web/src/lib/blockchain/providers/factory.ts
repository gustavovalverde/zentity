/**
 * Provider Factory
 *
 * Creates the appropriate provider instance based on network configuration.
 * Uses the factory pattern to abstract provider instantiation.
 */
import "server-only";

import type { IAttestationProvider } from "./types";

import { getNetworkById, isNetworkAvailable } from "../config/networks";
import { FhevmMockProvider } from "./fhevm-mock-provider";
import { FhevmZamaProvider } from "./fhevm-zama-provider";

// Cache providers to avoid recreating them for each request
const providerCache = new Map<string, IAttestationProvider>();

/**
 * Create or retrieve a provider for the specified network.
 *
 * @param networkId - Network identifier (e.g., "fhevm_sepolia", "hardhat")
 * @returns Provider instance for the network
 * @throws Error if network is unknown or not configured
 */
export function createProvider(networkId: string): IAttestationProvider {
  // Check cache first
  const cached = providerCache.get(networkId);
  if (cached) {
    return cached;
  }

  // Get network configuration
  const network = getNetworkById(networkId);
  if (!network) {
    throw new Error(`Unknown network: ${networkId}`);
  }

  if (!isNetworkAvailable(networkId)) {
    throw new Error(
      `Network ${networkId} is not available. Check that it's enabled and contracts are configured.`
    );
  }

  // Create appropriate provider based on network type
  if (network.type !== "fhevm") {
    throw new Error(
      `Unsupported provider type: ${network.type}. Only "fhevm" is supported.`
    );
  }

  const providerId = network.providerId ?? "zama";
  let provider: IAttestationProvider;

  if (providerId === "zama") {
    provider = new FhevmZamaProvider(network);
  } else if (providerId === "mock") {
    provider = new FhevmMockProvider(network);
  } else {
    throw new Error(`Unknown FHEVM provider: ${providerId}`);
  }

  // Cache and return
  providerCache.set(networkId, provider);
  return provider;
}

/**
 * Check if a provider can be created for a network.
 *
 * @param networkId - Network identifier
 * @returns True if provider can be created
 */
export function canCreateProvider(networkId: string): boolean {
  return isNetworkAvailable(networkId);
}
