/**
 * Standard EVM Attestation Provider
 *
 * Handles attestation on standard EVM networks (non-fhEVM).
 * Submits plain values without encryption.
 *
 * Note: This provider is for future use on networks that don't support FHE.
 * The contract interface may differ from the fhEVM version.
 */
import "server-only";

import type { NetworkConfig } from "../config/networks";
import type {
  AttestationParams,
  AttestationResult,
  IAttestationProvider,
} from "./types";

import { BaseProvider } from "./base-provider";

// Standard EVM IdentityRegistry ABI (non-encrypted)
// Note: This would be a different contract than the fhEVM version
const IDENTITY_REGISTRY_ABI = [
  {
    inputs: [
      { name: "user", type: "address" },
      { name: "birthYearOffset", type: "uint8" },
      { name: "countryCode", type: "uint16" },
      { name: "kycLevel", type: "uint8" },
      { name: "isBlacklisted", type: "bool" },
    ],
    name: "attestIdentity",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ name: "user", type: "address" }],
    name: "isAttested",
    outputs: [{ type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

/**
 * Provider for standard EVM networks.
 *
 * Submits attestations without encryption.
 * Used for networks that don't support FHE.
 */
export class EvmProvider extends BaseProvider implements IAttestationProvider {
  constructor(config: NetworkConfig) {
    super(config);

    if (config.type !== "evm") {
      throw new Error(
        `EvmProvider requires evm network type, got: ${config.type}`,
      );
    }
  }

  /**
   * Submit an attestation (non-encrypted).
   *
   * Warning: This exposes identity data on-chain in plaintext.
   * Only use on private/permissioned networks or for testing.
   */
  async submitAttestation(
    params: AttestationParams,
  ): Promise<AttestationResult> {
    try {
      const client = this.getWalletClient();
      const contractAddress = this.getContractAddress();

      const registrarBalance = await client.getBalance({
        address: client.account.address,
      });
      if (registrarBalance === BigInt(0)) {
        throw new Error(
          `Registrar wallet ${client.account.address} has no funds on ${this.networkName} (chainId ${this.config.chainId}).`,
        );
      }

      // Submit transaction with plain values (no encryption)
      const txHash = await client.writeContract({
        address: contractAddress,
        abi: IDENTITY_REGISTRY_ABI,
        functionName: "attestIdentity",
        args: [
          params.userAddress as `0x${string}`,
          params.identityData.birthYearOffset,
          params.identityData.countryCode,
          params.identityData.kycLevel,
          params.identityData.isBlacklisted,
        ],
      });

      return {
        status: "submitted",
        txHash,
      };
    } catch (error) {
      return {
        status: "failed",
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }
}
