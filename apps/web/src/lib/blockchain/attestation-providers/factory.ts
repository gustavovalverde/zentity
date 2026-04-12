/**
 * Provider Factory
 *
 * Creates AttestationProvider instances for configured networks.
 * In v2, a single provider class handles all networks (Hardhat + Sepolia)
 * since encryption moved client-side.
 */
import "server-only";

import type { IAttestationProvider } from "./types";

import { getNetworkById, isNetworkAvailable } from "../networks";
import { AttestationProvider } from "./base-provider";

const providerCache = new Map<string, IAttestationProvider>();

export function createProvider(networkId: string): IAttestationProvider {
  const cached = providerCache.get(networkId);
  if (cached) {
    return cached;
  }

  const network = getNetworkById(networkId);
  if (!network) {
    throw new Error(`Unknown network: ${networkId}`);
  }

  if (!isNetworkAvailable(networkId)) {
    throw new Error(
      `Network ${networkId} is not available. Check that it's enabled and contracts are configured.`
    );
  }

  const provider = new AttestationProvider(network);
  providerCache.set(networkId, provider);
  return provider;
}

export function canCreateProvider(networkId: string): boolean {
  return isNetworkAvailable(networkId);
}
