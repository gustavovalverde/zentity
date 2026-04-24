/**
 * Attestation provider
 *
 * One provider class + factory for all networks (Hardhat + Sepolia).
 * Server-side responsibilities:
 * - Sign EIP-712 permits (registrar authorization)
 * - Registrar-initiated revocation
 * - Read contract state
 *
 * Client-side (not in this module): FHEVM encryption, tx submission from user wallet.
 */
import "server-only";

import {
  ATTEST_PERMIT_TYPES,
  type AttestPermitData,
  getAttestPermitDomain,
  identityRegistryAbi,
} from "@zentity/contracts";
import {
  createWalletClient,
  decodeFunctionData,
  http,
  publicActions,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { hardhat, sepolia } from "viem/chains";

import {
  getNetworkById,
  isNetworkAvailable,
  type NetworkConfig,
} from "../networks";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Identity data values for attestation */
export interface IdentityData {
  birthYearOffset: number;
  complianceLevel: number;
  countryCode: number;
  isBlacklisted: boolean;
}

/** Result of signing an EIP-712 attestation permit */
export interface PermitResult {
  identityData: IdentityData;
  permit: AttestPermitData;
}

export type AttestationErrorCode =
  | "ALREADY_ATTESTED"
  | "CONTRACT"
  | "ENCRYPTION"
  | "INSUFFICIENT_FUNDS"
  | "NETWORK"
  | "NOT_ATTESTED"
  | "ONLY_REGISTRAR"
  | "UNKNOWN";

export interface AttestationResult {
  error?: string;
  errorCode?: AttestationErrorCode;
  status: "submitted" | "failed";
  txHash?: string;
}

export interface AttestationStatus {
  attestationId?: number | undefined;
  attestedAt?: string | undefined;
  blockNumber?: number | undefined;
  isAttested: boolean;
  txHash?: string | undefined;
}

export interface TransactionStatus {
  blockNumber?: number;
  confirmed: boolean;
  error?: string;
  failed: boolean;
}

export interface OnChainConsentReceipt {
  attributeMask: number;
  deadline: number;
  signature: `0x${string}`;
}

export type AttestationTransactionValidation =
  | { verdict: "valid"; consent: OnChainConsentReceipt }
  | { verdict: "invalid" }
  | { verdict: "pending_lookup" };

export interface IAttestationProvider {
  checkTransaction(txHash: string): Promise<TransactionStatus>;
  readonly config: NetworkConfig;
  getAttestationStatus(userAddress: string): Promise<AttestationStatus>;
  readonly networkId: string;
  readonly networkName: string;
  revokeAttestation(userAddress: string): Promise<AttestationResult>;
  signPermit(params: {
    userAddress: string;
    identityData: IdentityData;
    proofSetHash?: string;
    policyVersion?: number;
  }): Promise<PermitResult>;
  validateAttestationTransaction(params: {
    txHash: string;
    userAddress: string;
  }): Promise<AttestationTransactionValidation>;
}

// ---------------------------------------------------------------------------
// Provider implementation
// ---------------------------------------------------------------------------

const VIEM_CHAINS = {
  11155111: sepolia,
  31337: hardhat,
} as const;

export function toHexPrefixed(value: string): `0x${string}` {
  return (value.startsWith("0x") ? value : `0x${value}`) as `0x${string}`;
}

const TX_LOOKUP_MAX_ATTEMPTS = 20;
const TX_LOOKUP_RETRY_MS = 1000;

function isTransactionNotFoundError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("could not be found");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Decode the consent receipt components from an `attestWithPermit` call.
 * Argument positions (per IdentityRegistry.attestWithPermit):
 *   [0] permit struct
 *   [1] consentV (uint8)
 *   [2] consentR (bytes32)
 *   [3] consentS (bytes32)
 *   [4] attributeMask (uint8)
 *   [5] consentDeadline (uint256)
 *   [6..] encrypted handles + inputProof
 */
function decodeAttestWithPermitConsent(
  args: readonly unknown[] | undefined
): OnChainConsentReceipt | null {
  if (!args || args.length < 6) {
    return null;
  }

  const consentV = args[1] as number | bigint;
  const consentR = args[2] as `0x${string}`;
  const consentS = args[3] as `0x${string}`;
  const attributeMask = args[4] as number | bigint;
  const consentDeadline = args[5] as bigint;

  if (
    typeof consentR !== "string" ||
    typeof consentS !== "string" ||
    !consentR.startsWith("0x") ||
    !consentS.startsWith("0x")
  ) {
    return null;
  }

  const vByte = Number(consentV).toString(16).padStart(2, "0");
  const signature =
    `${consentR}${consentS.slice(2)}${vByte}`.toLowerCase() as `0x${string}`;

  return {
    attributeMask: Number(attributeMask),
    deadline: Number(consentDeadline),
    signature,
  };
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
    this.registrarPrivateKey = config.registrarPrivateKey || "";
  }

  private getWalletClient() {
    if (!this.registrarPrivateKey) {
      throw new Error(
        `Registrar private key is not configured for ${this.networkId}`
      );
    }

    const chain = VIEM_CHAINS[this.config.chainId as keyof typeof VIEM_CHAINS];
    if (!chain) {
      throw new Error(`Unsupported chain ID: ${this.config.chainId}`);
    }

    const account = privateKeyToAccount(
      toHexPrefixed(this.registrarPrivateKey)
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
      abi: identityRegistryAbi,
      functionName: "nonces",
      args: [userAddr],
    })) as bigint;

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
          return { verdict: "invalid" };
        }

        if (tx.from.toLowerCase() !== params.userAddress.toLowerCase()) {
          return { verdict: "invalid" };
        }

        const decoded = decodeFunctionData({
          abi: identityRegistryAbi,
          data: tx.input,
        });

        if (decoded.functionName !== "attestWithPermit") {
          return { verdict: "invalid" };
        }

        const consent = decodeAttestWithPermitConsent(decoded.args);
        if (!consent) {
          return { verdict: "invalid" };
        }

        return { verdict: "valid", consent };
      } catch (error) {
        if (
          isTransactionNotFoundError(error) &&
          attempt < TX_LOOKUP_MAX_ATTEMPTS - 1
        ) {
          await sleep(TX_LOOKUP_RETRY_MS);
          continue;
        }

        if (isTransactionNotFoundError(error)) {
          return { verdict: "pending_lookup" };
        }

        return { verdict: "invalid" };
      }
    }

    return { verdict: "pending_lookup" };
  }

  async getAttestationStatus(userAddress: string): Promise<AttestationStatus> {
    try {
      const client = this.getWalletClient();
      const contractAddress = this.getContractAddress();
      const addr = userAddress as `0x${string}`;

      const [isAttested, attestationId, timestamp] = await Promise.all([
        client.readContract({
          address: contractAddress,
          abi: identityRegistryAbi,
          functionName: "isAttested",
          args: [addr],
        }),
        client.readContract({
          address: contractAddress,
          abi: identityRegistryAbi,
          functionName: "currentAttestationId",
          args: [addr],
        }),
        client.readContract({
          address: contractAddress,
          abi: identityRegistryAbi,
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
      abi: identityRegistryAbi,
      functionName: "revokeIdentityFor",
      args: [userAddress as `0x${string}`],
    });
    return { status: "submitted", txHash };
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

const providerCache = new Map<string, IAttestationProvider>();

export function createProvider(networkId: string): IAttestationProvider {
  const cached = providerCache.get(networkId);
  if (cached) {
    return cached;
  }

  const network = getNetworkById(networkId);
  if (!network) {
    throw new Error(`Unknown network: ${networkId}`);
  }

  if (!isNetworkAvailable(networkId)) {
    throw new Error(
      `Network ${networkId} is not available. Check that it's enabled and contracts are configured.`
    );
  }

  const provider = new AttestationProvider(network);
  providerCache.set(networkId, provider);
  return provider;
}

export function canCreateProvider(networkId: string): boolean {
  return isNetworkAvailable(networkId);
}
