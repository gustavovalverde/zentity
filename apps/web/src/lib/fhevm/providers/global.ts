import type { FhevmProviderFactory } from "./types";

import { registerFhevmProvider } from "./registry";

const isBrowser = typeof window !== "undefined";

if (isBrowser) {
  const globalFactories = (
    window as Window & {
      __FHEVM_PROVIDER_FACTORIES__?: Record<string, FhevmProviderFactory>;
    }
  ).__FHEVM_PROVIDER_FACTORIES__;

  if (globalFactories) {
    for (const [id, factory] of Object.entries(globalFactories)) {
      registerFhevmProvider(id, factory);
    }
  }
}
