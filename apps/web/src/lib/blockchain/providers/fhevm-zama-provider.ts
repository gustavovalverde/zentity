/**
 * FHEVM Attestation Provider (Zama)
 *
 * Handles attestation on FHEVM networks using encrypted inputs.
 * Uses the Zama relayer SDK for testnet/mainnet environments.
 */
import "server-only";

import type { NetworkConfig } from "../config/networks";
import type {
  AttestationParams,
  AttestationResult,
  IAttestationProvider,
} from "./types";

import { BaseProvider } from "./base-provider";
import {
  categorizeError,
  getErrorSummary,
  IDENTITY_REGISTRY_ABI,
} from "./fhevm-utils";

/**
 * Provider for FHEVM networks.
 *
 * Creates encrypted inputs using the Zama relayer SDK before submitting attestations.
 * This ensures identity data is encrypted on-chain.
 */
export class FhevmZamaProvider
  extends BaseProvider
  implements IAttestationProvider
{
  constructor(config: NetworkConfig) {
    super(config);

    if (config.type !== "fhevm") {
      throw new Error(
        `FhevmZamaProvider requires fhevm network type, got: ${config.type}`,
      );
    }
  }

  /**
   * Create FHE instance for testnet using Zama relayer SDK.
   */
  private async createRelayerInstance() {
    // Next.js/undici Response.bytes() returns ArrayBuffer, but the relayer SDK
    // expects Uint8Array and fails to deserialize keys. Normalize bytes() here.
    const responseCtor = globalThis.Response as
      | { prototype?: Response }
      | undefined;
    const responseProto = responseCtor?.prototype as
      | (Response & {
          bytes?: () => Promise<Uint8Array>;
          __fhevmBytesPatch?: boolean;
        })
      | undefined;
    if (
      responseProto &&
      typeof responseProto.bytes === "function" &&
      !responseProto.__fhevmBytesPatch
    ) {
      const originalBytes = responseProto.bytes;
      const patchedBytes = async function bytesPatched(
        this: Response,
      ): Promise<Uint8Array> {
        const result = (await originalBytes.call(this)) as
          | Uint8Array
          | ArrayBuffer
          | ArrayBufferView;
        if (result instanceof ArrayBuffer) {
          return new Uint8Array(result);
        }
        if (ArrayBuffer.isView(result)) {
          return new Uint8Array(
            result.buffer,
            result.byteOffset,
            result.byteLength,
          );
        }
        return result as Uint8Array;
      };
      responseProto.bytes = patchedBytes as typeof responseProto.bytes;
      responseProto.__fhevmBytesPatch = true;
    }

    const { createInstance, MainnetConfig, SepoliaConfig } = await import(
      "@zama-fhe/relayer-sdk/node"
    );

    const relayerUrl =
      process.env.FHEVM_RELAYER_URL ||
      process.env.NEXT_PUBLIC_FHEVM_RELAYER_URL;
    const gatewayChainId = Number(
      process.env.FHEVM_GATEWAY_CHAIN_ID ||
        process.env.NEXT_PUBLIC_FHEVM_GATEWAY_CHAIN_ID ||
        "",
    );
    const aclContractAddress =
      process.env.FHEVM_ACL_CONTRACT_ADDRESS ||
      process.env.NEXT_PUBLIC_FHEVM_ACL_CONTRACT_ADDRESS;
    const kmsContractAddress =
      process.env.FHEVM_KMS_CONTRACT_ADDRESS ||
      process.env.NEXT_PUBLIC_FHEVM_KMS_CONTRACT_ADDRESS;
    const inputVerifierContractAddress =
      process.env.FHEVM_INPUT_VERIFIER_CONTRACT_ADDRESS ||
      process.env.NEXT_PUBLIC_FHEVM_INPUT_VERIFIER_CONTRACT_ADDRESS;
    const verifyingContractAddressDecryption =
      process.env.FHEVM_DECRYPTION_ADDRESS ||
      process.env.NEXT_PUBLIC_FHEVM_DECRYPTION_ADDRESS;
    const verifyingContractAddressInputVerification =
      process.env.FHEVM_INPUT_VERIFICATION_ADDRESS ||
      process.env.NEXT_PUBLIC_FHEVM_INPUT_VERIFICATION_ADDRESS;

    // Select config based on chain ID (mainnet = 1, otherwise Sepolia)
    const baseConfig =
      this.config.chainId === 1 ? MainnetConfig : SepoliaConfig;

    return createInstance({
      ...baseConfig,
      chainId: this.config.chainId,
      ...(Number.isFinite(gatewayChainId) && gatewayChainId > 0
        ? { gatewayChainId }
        : {}),
      ...(aclContractAddress ? { aclContractAddress } : {}),
      ...(kmsContractAddress ? { kmsContractAddress } : {}),
      ...(inputVerifierContractAddress ? { inputVerifierContractAddress } : {}),
      ...(verifyingContractAddressDecryption
        ? { verifyingContractAddressDecryption }
        : {}),
      ...(verifyingContractAddressInputVerification
        ? { verifyingContractAddressInputVerification }
        : {}),
      ...(relayerUrl ? { relayerUrl } : {}),
      network: this.config.rpcUrl,
    });
  }

  /**
   * Submit an encrypted attestation.
   *
   * Flow:
   * 1. Initialize FHE instance using the Zama relayer SDK
   * 2. Create encrypted inputs for all identity fields
   * 3. Sign and submit transaction with registrar wallet
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

      // Use Zama relayer SDK for testnet/mainnet
      const fhevm = await this.createRelayerInstance();

      // Create encrypted inputs
      const encryptedInput = fhevm.createEncryptedInput(
        contractAddress,
        client.account.address,
      );

      // Add all identity fields as encrypted values
      encryptedInput.add8(params.identityData.birthYearOffset); // euint8
      encryptedInput.add16(params.identityData.countryCode); // euint16
      encryptedInput.add8(params.identityData.complianceLevel); // euint8
      encryptedInput.addBool(params.identityData.isBlacklisted); // ebool

      // Encrypt and get handles + proof
      const encrypted = await encryptedInput.encrypt();

      // Helper to convert Uint8Array to hex string
      const toHex = (bytes: Uint8Array): `0x${string}` =>
        `0x${Array.from(bytes)
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("")}` as `0x${string}`;

      // Convert handles and inputProof to hex strings
      const handles = encrypted.handles.map(toHex);
      const inputProofHex = toHex(encrypted.inputProof);

      // Submit transaction
      const txHash = await client.writeContract({
        address: contractAddress,
        abi: IDENTITY_REGISTRY_ABI,
        functionName: "attestIdentity",
        args: [
          params.userAddress as `0x${string}`,
          handles[0], // encBirthYearOffset
          handles[1], // encCountryCode
          handles[2], // encComplianceLevel
          handles[3], // encIsBlacklisted
          inputProofHex,
        ],
      });

      return {
        status: "submitted",
        txHash,
      };
    } catch (error) {
      const summary = getErrorSummary(error);
      const errorCode = categorizeError(error);

      return {
        status: "failed",
        error: summary.shortMessage,
        errorCode,
      };
    }
  }
}
