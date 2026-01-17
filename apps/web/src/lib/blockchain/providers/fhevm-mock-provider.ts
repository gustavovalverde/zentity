/**
 * FHEVM Attestation Provider (Mock / Hardhat)
 *
 * Uses @fhevm/mock-utils + the Hardhat relayer RPC to create encrypted inputs.
 * Intended for local development with the hardhat plugin.
 */
import "server-only";

import type { NetworkConfig } from "../config/networks";
import type {
  AttestationParams,
  AttestationResult,
  IAttestationProvider,
} from "./types";

import { FhevmType } from "@fhevm/mock-utils";
import { IdentityRegistryABI } from "@zentity/fhevm-contracts";

import { BaseProvider } from "./base-provider";
import { categorizeError, getErrorSummary } from "./fhevm-utils";

export class FhevmMockProvider
  extends BaseProvider
  implements IAttestationProvider
{
  constructor(config: NetworkConfig) {
    super(config);

    if (config.type !== "fhevm") {
      throw new Error(
        `FhevmMockProvider requires fhevm network type, got: ${config.type}`
      );
    }
  }

  /**
   * Create encrypted input handles and proof using Hardhat's RPC.
   * Uses the fhevm_relayer_v1_input_proof RPC method to get properly signed proofs
   * from the Hardhat plugin's registered coprocessor signers.
   *
   * Types from @fhevm/mock-utils: relayer.MockRelayerV1InputProofPayload, relayer.MockRelayerData
   */
  private async createHardhatEncryptedInput(
    contractAddress: string,
    userAddress: string,
    identityData: AttestationParams["identityData"]
  ): Promise<{ handles: `0x${string}`[]; inputProof: `0x${string}` }> {
    const {
      JsonRpcProvider,
      keccak256,
      randomBytes,
      concat,
      toBeHex,
      hexlify,
      ZeroHash,
    } = await import("ethers");

    const provider = new JsonRpcProvider(this.config.rpcUrl);

    // Fetch ACL address from Hardhat node metadata
    const metadata = (await provider.send("fhevm_relayer_metadata", [])) as {
      ACLAddress: string;
    };

    // Build the values with their types (using FhevmType from @fhevm/mock-utils)
    // Contract expects: euint8, euint16, euint8, ebool
    const values: {
      value: bigint;
      fheType: FhevmType;
      fhevmType: FhevmType;
      byteLength: number;
    }[] = [
      {
        value: BigInt(identityData.birthYearOffset),
        fheType: FhevmType.euint8,
        fhevmType: FhevmType.euint8,
        byteLength: 1,
      },
      {
        value: BigInt(identityData.countryCode),
        fheType: FhevmType.euint16,
        fhevmType: FhevmType.euint16,
        byteLength: 2,
      },
      {
        value: BigInt(identityData.complianceLevel),
        fheType: FhevmType.euint8,
        fhevmType: FhevmType.euint8,
        byteLength: 1,
      },
      {
        value: identityData.isBlacklisted ? BigInt(1) : BigInt(0),
        fheType: FhevmType.ebool,
        fhevmType: FhevmType.ebool,
        byteLength: 1,
      },
    ];

    // Compute mock ciphertext (same algorithm as MockRelayerEncryptedInput)
    // For each value: [fheType (1 byte)] + [value (X bytes)] + [random32]
    const parts: Uint8Array[] = [];
    const clearTextValuesBigIntHex: string[] = [];
    const fheTypes: number[] = [];
    const fhevmTypes: number[] = [];
    const random32List: string[] = [];

    for (const { value, fheType, fhevmType, byteLength } of values) {
      const fheTypeByte = new Uint8Array([fheType]);
      const valueBytes = new Uint8Array(byteLength);
      // Convert bigint to bytes (big-endian)
      let v = value;
      for (let i = byteLength - 1; i >= 0; i--) {
        valueBytes[i] = Number(v % BigInt(256));
        v /= BigInt(256);
      }
      const random32 = randomBytes(32);
      parts.push(fheTypeByte, valueBytes, random32);

      // Build mockData arrays
      clearTextValuesBigIntHex.push(toBeHex(value));
      fheTypes.push(fheType);
      fhevmTypes.push(fhevmType);
      random32List.push(hexlify(random32));
    }

    // Concatenate all parts and hash
    const concatenated = concat(parts);
    const ciphertextWithInputVerification = keccak256(concatenated);

    // Build mockData for the Hardhat plugin's mock database
    // Types: MockRelayerData from @fhevm/mock-utils
    const mockData = {
      clearTextValuesBigIntHex,
      metadatas: values.map(() => ({
        blockNumber: 0,
        index: 0,
        transactionHash: ZeroHash,
      })),
      fheTypes,
      fhevmTypes,
      aclContractAddress: metadata.ACLAddress,
      random32List,
    };

    // Call Hardhat's RPC to get properly signed proof
    // Payload type: MockRelayerV1InputProofPayload from @fhevm/mock-utils
    const response = (await provider.send("fhevm_relayer_v1_input_proof", [
      {
        contractAddress,
        userAddress,
        ciphertextWithInputVerification,
        contractChainId: `0x${this.config.chainId.toString(16)}`,
        extraData: "0x00",
        mockData,
      },
    ])) as { handles: string[]; signatures: string[] };

    // Compute inputProof from handles + signatures
    // Format: numHandles (1 byte) + numSigners (1 byte) + handles (32 bytes each) + signatures (65 bytes each) + extraData
    // Note: RPC returns handles and signatures WITHOUT 0x prefix
    const numHandles = response.handles.length;
    const numSigners = response.signatures.length;
    const handlesHex = response.handles.join(""); // Already without 0x prefix
    const signaturesHex = response.signatures.join(""); // Already without 0x prefix
    const extraDataHex = "00"; // extraData without 0x prefix

    const inputProof =
      `0x${numHandles.toString(16).padStart(2, "0")}${numSigners.toString(16).padStart(2, "0")}${handlesHex}${signaturesHex}${extraDataHex}` as `0x${string}`;

    // Add 0x prefix to handles for use as bytes32 in contract call
    const handlesWithPrefix: `0x${string}`[] = response.handles.map(
      (h): `0x${string}` => `0x${h}`
    );

    return {
      handles: handlesWithPrefix,
      inputProof,
    };
  }

  /**
   * Submit an encrypted attestation using Hardhat's mock relayer.
   */
  async submitAttestation(
    params: AttestationParams
  ): Promise<AttestationResult> {
    try {
      const client = this.getWalletClient();
      const contractAddress = this.getContractAddress();

      const registrarBalance = await client.getBalance({
        address: client.account.address,
      });
      if (registrarBalance === BigInt(0)) {
        throw new Error(
          `Registrar wallet ${client.account.address} has no funds on ${this.networkName} (chainId ${this.config.chainId}).`
        );
      }

      const encrypted = await this.createHardhatEncryptedInput(
        contractAddress,
        client.account.address,
        params.identityData
      );

      const txHash = await client.writeContract({
        address: contractAddress,
        abi: IdentityRegistryABI,
        functionName: "attestIdentity",
        args: [
          params.userAddress as `0x${string}`,
          encrypted.handles[0], // encBirthYearOffset
          encrypted.handles[1], // encCountryCode
          encrypted.handles[2], // encKycLevel
          encrypted.handles[3], // encIsBlacklisted
          encrypted.inputProof,
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
