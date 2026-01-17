import type { FhevmInstance } from "../types";

export type FhevmProviderId = "zama" | "mock" | (string & Record<never, never>);

export interface FhevmProviderInitParams {
  provider: unknown;
  chainId: number;
  rpcUrl?: string;
  signal: AbortSignal;
}

export type FhevmProviderFactory = (
  params: FhevmProviderInitParams
) => Promise<FhevmInstance>;
