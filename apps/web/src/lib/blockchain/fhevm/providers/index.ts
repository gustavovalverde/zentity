/**
 * FHEVM Provider Registry
 *
 * Provides a unified interface for FHE SDK initialization across different providers.
 * Built-in providers: "zama" (production) and "mock" (Hardhat testing).
 *
 * External providers can be registered via `window.__FHEVM_PROVIDER_FACTORIES__`
 * before this module loads, or via `registerFhevmProvider()` at runtime.
 */
import type { FhevmInstance } from "../types";

import { createMockInstance } from "./mock";
import { createZamaRelayerInstance } from "./zama/relayer";

// --- Types ---

export type FhevmProviderId = "zama" | "mock" | (string & Record<never, never>);

interface FhevmProviderInitParams {
  provider: unknown;
  chainId: number;
  rpcUrl?: string;
  signal: AbortSignal;
}

export type FhevmProviderFactory = (
  params: FhevmProviderInitParams
) => Promise<FhevmInstance>;

// --- Registry ---

const registry = new Map<FhevmProviderId, FhevmProviderFactory>([
  ["zama", createZamaRelayerInstance],
  ["mock", createMockInstance],
]);

export function registerFhevmProvider(
  id: FhevmProviderId,
  factory: FhevmProviderFactory
): void {
  registry.set(id, factory);
}

export function resolveFhevmProviderFactory(
  id: FhevmProviderId
): FhevmProviderFactory | undefined {
  return registry.get(id);
}

// --- Global Registration (Browser Only) ---

const isBrowser = globalThis.window !== undefined;

if (isBrowser) {
  const globalFactories = (
    globalThis.window as Window & {
      __FHEVM_PROVIDER_FACTORIES__?: Record<string, FhevmProviderFactory>;
    }
  ).__FHEVM_PROVIDER_FACTORIES__;

  if (globalFactories) {
    for (const [id, factory] of Object.entries(globalFactories)) {
      registerFhevmProvider(id, factory);
    }
  }
}
