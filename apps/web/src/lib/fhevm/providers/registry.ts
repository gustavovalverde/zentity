import type { FhevmProviderFactory, FhevmProviderId } from "./types";

import { createMockInstance } from "./mock";
import { createZamaRelayerInstance as createZamaProvider } from "./zama/relayer";

const registry = new Map<FhevmProviderId, FhevmProviderFactory>([
  ["zama", createZamaProvider],
  ["mock", createMockInstance],
]);

export function registerFhevmProvider(
  id: FhevmProviderId,
  factory: FhevmProviderFactory
) {
  registry.set(id, factory);
}

export function resolveFhevmProviderFactory(
  id: FhevmProviderId
): FhevmProviderFactory | undefined {
  return registry.get(id);
}
