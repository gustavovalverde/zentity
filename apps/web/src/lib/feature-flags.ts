/**
 * Feature Flags
 * Centralized feature flag management for conditional UI rendering.
 */

/**
 * Check if Web3/FHEVM features are enabled.
 * Used to conditionally render blockchain-related UI sections.
 */
export function isWeb3Enabled(): boolean {
  const fhevmEnabled = process.env.NEXT_PUBLIC_ENABLE_FHEVM !== "false";
  const hardhatEnabled = process.env.NEXT_PUBLIC_ENABLE_HARDHAT === "true";
  return fhevmEnabled || hardhatEnabled;
}
