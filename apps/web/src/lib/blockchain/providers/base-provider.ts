/**
 * Base Attestation Provider
 *
 * Abstract base class with shared functionality for all providers.
 * Network-specific providers extend this to implement encryption logic.
 */
import "server-only";

import type { NetworkConfig } from "../networks";
import type {
  AttestationStatus,
  IAttestationProvider,
  TransactionStatus,
} from "./types";

import { IdentityRegistryABI } from "@zentity/fhevm-contracts";
import { createWalletClient, http, publicActions } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { hardhat, sepolia } from "viem/chains";

// Chain configurations for viem
const VIEM_CHAINS = {
  11155111: sepolia,
  31337: hardhat,
} as const;

/**
 * Abstract base provider with shared wallet/transaction logic.
 */
export abstract class BaseProvider implements Partial<IAttestationProvider> {
  readonly networkId: string;
  readonly networkName: string;
  readonly config: NetworkConfig;

  protected readonly registrarPrivateKey: string;

  constructor(config: NetworkConfig) {
    this.config = config;
    this.networkId = config.id;
    this.networkName = config.name;
    this.registrarPrivateKey =
      config.registrarPrivateKey || process.env.REGISTRAR_PRIVATE_KEY || "";

    if (!this.registrarPrivateKey) {
      /* Warning: Registrar private key not configured - write operations will fail */
    }
  }

  /**
   * Create a viem wallet client for the registrar.
   */
  protected getWalletClient() {
    if (!this.registrarPrivateKey) {
      throw new Error("REGISTRAR_PRIVATE_KEY not configured");
    }

    const chain = VIEM_CHAINS[this.config.chainId as keyof typeof VIEM_CHAINS];
    if (!chain) {
      throw new Error(`Unsupported chain ID: ${this.config.chainId}`);
    }

    const account = privateKeyToAccount(
      (this.registrarPrivateKey.startsWith("0x")
        ? this.registrarPrivateKey
        : `0x${this.registrarPrivateKey}`) as `0x${string}`
    );

    return createWalletClient({
      account,
      chain,
      transport: http(this.config.rpcUrl),
    }).extend(publicActions);
  }

  /**
   * Get the IdentityRegistry contract address.
   */
  protected getContractAddress(): `0x${string}` {
    const address = this.config.contracts.identityRegistry;
    if (!address) {
      throw new Error(
        `IdentityRegistry contract not configured for ${this.networkId}`
      );
    }
    return address as `0x${string}`;
  }

  /**
   * Check transaction confirmation status.
   */
  async checkTransaction(txHash: string): Promise<TransactionStatus> {
    try {
      const client = this.getWalletClient();
      const receipt = await client.getTransactionReceipt({
        hash: txHash as `0x${string}`,
      });

      if (!receipt) {
        return { confirmed: false, failed: false };
      }

      if (receipt.status === "success") {
        return {
          confirmed: true,
          failed: false,
          blockNumber: Number(receipt.blockNumber),
        };
      }

      return {
        confirmed: false,
        failed: true,
        error: "Transaction reverted",
      };
    } catch (error) {
      // Transaction not found yet - still pending
      if (
        error instanceof Error &&
        error.message.includes("could not be found")
      ) {
        return { confirmed: false, failed: false };
      }
      throw error;
    }
  }

  /**
   * Check if user is attested on-chain.
   * This queries the IdentityRegistry.isAttested() view function.
   */
  async getAttestationStatus(userAddress: string): Promise<AttestationStatus> {
    try {
      const client = this.getWalletClient();
      const contractAddress = this.getContractAddress();

      // Call isAttested view function
      const isAttested = await client.readContract({
        address: contractAddress,
        abi: IdentityRegistryABI,
        functionName: "isAttested",
        args: [userAddress as `0x${string}`],
      });

      return {
        isAttested: Boolean(isAttested),
      };
    } catch {
      return { isAttested: false };
    }
  }
}
