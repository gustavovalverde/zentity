/**
 * Attestation Provider (v2)
 *
 * Handles server-side attestation operations:
 * - Signs EIP-712 permits for user-submitted attestations
 * - Registrar-initiated revocation via revokeIdentityFor
 * - Reads contract state (attestation status, tx confirmation)
 *
 * Encryption and tx submission happen client-side via FHEVM SDK + wagmi.
 */
import "server-only";

import type { NetworkConfig } from "../networks";
import type {
  AttestationResult,
  AttestationStatus,
  AttestationTransactionValidation,
  IAttestationProvider,
  IdentityData,
  PermitResult,
  TransactionStatus,
} from "./types";

import {
  ATTEST_PERMIT_TYPES,
  type AttestPermitData,
  getAttestPermitDomain,
  IdentityRegistryABI,
} from "@zentity/fhevm-contracts";
import {
  createWalletClient,
  decodeFunctionData,
  http,
  publicActions,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { hardhat, sepolia } from "viem/chains";

import { env } from "@/env";

const VIEM_CHAINS = {
  11155111: sepolia,
  31337: hardhat,
} as const;

const TX_LOOKUP_MAX_ATTEMPTS = 20;
const TX_LOOKUP_RETRY_MS = 1000;

function isTransactionNotFoundError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("could not be found");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class AttestationProvider implements IAttestationProvider {
  readonly networkId: string;
  readonly networkName: string;
  readonly config: NetworkConfig;

  private readonly registrarPrivateKey: string;

  constructor(config: NetworkConfig) {
    this.config = config;
    this.networkId = config.id;
    this.networkName = config.name;
    this.registrarPrivateKey =
      config.registrarPrivateKey || env.REGISTRAR_PRIVATE_KEY || "";
  }

  private getWalletClient() {
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

  private getContractAddress(): `0x${string}` {
    const address = this.config.contracts.identityRegistry;
    if (!address) {
      throw new Error(
        `IdentityRegistry contract not configured for ${this.networkId}`
      );
    }
    return address as `0x${string}`;
  }

  /** Sign an EIP-712 attestation permit with the registrar key */
  async signPermit(params: {
    userAddress: string;
    identityData: IdentityData;
    proofSetHash?: string;
    policyVersion?: number;
  }): Promise<PermitResult> {
    const client = this.getWalletClient();
    const contractAddress = this.getContractAddress();
    const userAddr = params.userAddress as `0x${string}`;

    const nonce = (await client.readContract({
      address: contractAddress,
      abi: IdentityRegistryABI,
      functionName: "nonces",
      args: [userAddr],
    })) as bigint;

    // Build deadline (1 hour from latest block)
    const block = await client.getBlock({ blockTag: "latest" });
    const deadline = block.timestamp + 3600n;

    const domain = getAttestPermitDomain(this.config.chainId, contractAddress);

    const zeroHash =
      "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`;

    const normalizedProofSetHash = params.proofSetHash
      ? ((params.proofSetHash.startsWith("0x")
          ? params.proofSetHash
          : `0x${params.proofSetHash}`) as `0x${string}`)
      : zeroHash;

    const message = {
      user: userAddr,
      birthYearOffset: params.identityData.birthYearOffset,
      countryCode: params.identityData.countryCode,
      complianceLevel: params.identityData.complianceLevel,
      isBlacklisted: params.identityData.isBlacklisted,
      proofSetHash: normalizedProofSetHash,
      policyVersion: params.policyVersion ?? 1,
      nonce,
      deadline,
    };

    const signature = await client.account.signTypedData({
      domain: {
        ...domain,
        chainId: BigInt(domain.chainId),
        verifyingContract: domain.verifyingContract as `0x${string}`,
      },
      types: ATTEST_PERMIT_TYPES,
      primaryType: "AttestPermit",
      message,
    });

    // Split signature into v, r, s
    const { v, r, s } = (() => {
      const sig = signature.slice(2);
      return {
        r: `0x${sig.slice(0, 64)}` as string,
        s: `0x${sig.slice(64, 128)}` as string,
        v: Number.parseInt(sig.slice(128, 130), 16),
      };
    })();

    const permit: AttestPermitData = {
      birthYearOffset: params.identityData.birthYearOffset,
      countryCode: params.identityData.countryCode,
      complianceLevel: params.identityData.complianceLevel,
      isBlacklisted: params.identityData.isBlacklisted,
      proofSetHash: message.proofSetHash,
      policyVersion: message.policyVersion,
      deadline: Number(deadline),
      v,
      r,
      s,
    };

    return {
      permit,
      identityData: params.identityData,
    };
  }

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

      return { confirmed: false, failed: true, error: "Transaction reverted" };
    } catch (error) {
      if (isTransactionNotFoundError(error)) {
        return { confirmed: false, failed: false };
      }
      throw error;
    }
  }

  async validateAttestationTransaction(params: {
    txHash: string;
    userAddress: string;
  }): Promise<AttestationTransactionValidation> {
    const client = this.getWalletClient();
    const contractAddress = this.getContractAddress();

    for (let attempt = 0; attempt < TX_LOOKUP_MAX_ATTEMPTS; attempt++) {
      try {
        const tx = await client.getTransaction({
          hash: params.txHash as `0x${string}`,
        });

        if (!tx.to || tx.to.toLowerCase() !== contractAddress.toLowerCase()) {
          return "invalid";
        }

        if (tx.from.toLowerCase() !== params.userAddress.toLowerCase()) {
          return "invalid";
        }

        const decoded = decodeFunctionData({
          abi: IdentityRegistryABI,
          data: tx.input,
        });

        return decoded.functionName === "attestWithPermit"
          ? "valid"
          : "invalid";
      } catch (error) {
        if (
          isTransactionNotFoundError(error) &&
          attempt < TX_LOOKUP_MAX_ATTEMPTS - 1
        ) {
          await sleep(TX_LOOKUP_RETRY_MS);
          continue;
        }

        if (isTransactionNotFoundError(error)) {
          return "pending_lookup";
        }

        return "invalid";
      }
    }

    return "pending_lookup";
  }

  async getAttestationStatus(userAddress: string): Promise<AttestationStatus> {
    try {
      const client = this.getWalletClient();
      const contractAddress = this.getContractAddress();
      const addr = userAddress as `0x${string}`;

      const [isAttested, attestationId, timestamp] = await Promise.all([
        client.readContract({
          address: contractAddress,
          abi: IdentityRegistryABI,
          functionName: "isAttested",
          args: [addr],
        }),
        client.readContract({
          address: contractAddress,
          abi: IdentityRegistryABI,
          functionName: "currentAttestationId",
          args: [addr],
        }),
        client.readContract({
          address: contractAddress,
          abi: IdentityRegistryABI,
          functionName: "attestationTimestamp",
          args: [addr],
        }),
      ]);

      const ts = Number(timestamp as bigint);

      return {
        isAttested: Boolean(isAttested),
        attestationId: Number(attestationId as bigint),
        attestedAt: ts > 0 ? new Date(ts * 1000).toISOString() : undefined,
      };
    } catch {
      return { isAttested: false };
    }
  }

  /** Registrar-initiated revocation via revokeIdentityFor */
  async revokeAttestation(userAddress: string): Promise<AttestationResult> {
    const client = this.getWalletClient();
    const txHash = await client.writeContract({
      address: this.getContractAddress(),
      abi: IdentityRegistryABI,
      functionName: "revokeIdentityFor",
      args: [userAddress as `0x${string}`],
    });
    return { status: "submitted", txHash };
  }
}
