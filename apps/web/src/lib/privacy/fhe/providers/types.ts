import type { FhevmInstance } from "../types";

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
