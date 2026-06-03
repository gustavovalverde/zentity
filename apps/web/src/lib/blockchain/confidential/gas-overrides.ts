import {
  HARDHAT_CONFIDENTIAL_CHAIN_ID,
  SEPOLIA_CONFIDENTIAL_CHAIN_ID,
} from "./client-networks";

/**
 * Per-(chain, operation) gas budgets for confidential-chain writes.
 *
 * Wagmi's eth_estimateGas under-estimates Zama operations because the relayer
 * touches state during execution that the estimator cannot see (proof checks,
 * ACL bookkeeping, ciphertext handle writes). Each entry is a measured upper
 * bound with ~30% headroom; re-measure whenever contracts or the relayer change.
 */
type ConfidentialWriteOperation = "attestWithPermit" | "grantAttributeAccess";

const GAS_BUDGET: Record<
  ConfidentialWriteOperation,
  Partial<Record<number, bigint>>
> = {
  attestWithPermit: {
    [HARDHAT_CONFIDENTIAL_CHAIN_ID]: 5_000_000n,
    [SEPOLIA_CONFIDENTIAL_CHAIN_ID]: 1_000_000n,
  },
  grantAttributeAccess: {
    [HARDHAT_CONFIDENTIAL_CHAIN_ID]: 500_000n,
    [SEPOLIA_CONFIDENTIAL_CHAIN_ID]: 1_000_000n,
  },
};

export function getConfidentialGasOverride(
  operation: ConfidentialWriteOperation,
  chainId: number | undefined
): { gas: bigint } | undefined {
  if (chainId === undefined) {
    return undefined;
  }
  const gas = GAS_BUDGET[operation][chainId];
  return gas === undefined ? undefined : { gas };
}
