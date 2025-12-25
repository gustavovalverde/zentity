/**
 * Blockchain Module
 *
 * Multi-network attestation support for Zentity.
 * Provides a provider-agnostic interface for on-chain identity attestation.
 *
 * Usage:
 * ```typescript
 * import {
 *   getEnabledNetworks,
 *   createProvider,
 * } from "@/lib/blockchain";
 *
 * // List available networks
 * const networks = getEnabledNetworks();
 *
 * // Create provider for specific network
 * const provider = createProvider("fhevm_sepolia");
 *
 * // Submit attestation
 * const result = await provider.submitAttestation({
 *   userAddress: "0x...",
 *   identityData: { birthYearOffset: 90, countryCode: 840, kycLevel: 3, isBlacklisted: false }
 * });
 * ```
 */

// Provider types
export type {
  AttestationParams,
  AttestationResult,
  AttestationStatus,
  IAttestationProvider,
  TransactionStatus,
} from "./providers/types";

// Network configuration
export {
  getEnabledNetworks,
  getExplorerTxUrl,
  getNetworkById,
  isDemoMode,
  type NetworkConfig,
  type NetworkFeature,
  type NetworkType,
} from "./config/networks";
// Provider factory
export { canCreateProvider, createProvider } from "./providers/factory";
