"use client";

/**
 * FHE Client-Side Encryption Hook
 *
 * Encrypts values locally before sending them to smart contracts.
 *
 * ## Why Client-Side Encryption?
 * In fhEVM, sensitive data must be encrypted before it reaches the blockchain.
 * This ensures:
 * - Only the user knows their plaintext values
 * - The contract only ever sees encrypted handles
 * - Privacy is preserved end-to-end
 *
 * ## How Encryption Works
 * 1. Call `encryptWith()` with a builder function
 * 2. Builder adds values (e.g., `builder.add64(amount)`)
 * 3. SDK encrypts values and generates a ZK proof
 * 4. Returns handles (references) + inputProof (validity proof)
 * 5. Send handles + proof to the contract
 * 6. Contract's InputVerifier validates the proof
 * 7. Handle gets stored, actual ciphertext goes to KMS
 *
 * ## Encrypted Types
 * Smart contracts use these types for encrypted values:
 * - `ebool` - encrypted boolean
 * - `euint8/16/32/64/128/256` - encrypted unsigned integers
 * - `eaddress` - encrypted Ethereum address
 *
 * @example
 * ```tsx
 * const { encryptWith, canEncrypt } = useFHEEncryption({
 *   instance,
 *   ethersSigner,
 *   contractAddress,
 * });
 *
 * const result = await encryptWith((builder) => {
 *   builder.add64(1000n); // Encrypt 1000 as euint64
 * });
 *
 * // Send to contract: result.handles[0] + result.inputProof
 * ```
 */
import type { ethers } from "ethers";
import type { EncryptResult, FhevmInstance } from "@/lib/fhevm/types";

import { useCallback, useMemo } from "react";

import { recordClientMetric } from "@/lib/observability/client-metrics";

/** ABI input/output parameter definition */
interface AbiParameter {
  name: string;
  type: string;
  internalType?: string;
  components?: AbiParameter[];
}

/** ABI function item */
interface AbiFunctionItem {
  type: "function";
  name: string;
  inputs: AbiParameter[];
  outputs?: AbiParameter[];
  stateMutability?: string;
}

/** ABI item (function, event, etc.) */
type AbiItem = AbiFunctionItem | { type: string; name?: string };

/**
 * Map Solidity encrypted type to SDK builder method.
 *
 * In contract ABIs, encrypted inputs use "external" types (e.g., externalEuint64).
 * The SDK builder has corresponding methods (add64, add128, etc.).
 *
 * @example
 * // Contract function: transfer(externalEuint64 amount, bytes inputProof)
 * // Maps to: builder.add64(amount)
 */
const _getEncryptionMethod = (internalType: string) => {
  switch (internalType) {
    case "externalEbool":
      return "addBool" as const;
    case "externalEuint8":
      return "add8" as const;
    case "externalEuint16":
      return "add16" as const;
    case "externalEuint32":
      return "add32" as const;
    case "externalEuint64":
      return "add64" as const;
    case "externalEuint128":
      return "add128" as const;
    case "externalEuint256":
      return "add256" as const;
    case "externalEaddress":
      return "addAddress" as const;
    default:
      return "add64" as const;
  }
};

/**
 * Convert Uint8Array or hex string to 0x-prefixed hex string.
 * Handles and proofs from the SDK are often Uint8Array but contracts expect hex.
 */
export const toHex = (value: Uint8Array | string): `0x${string}` => {
  if (typeof value === "string") {
    return (value.startsWith("0x") ? value : `0x${value}`) as `0x${string}`;
  }
  return `0x${Array.from(value)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}` as `0x${string}`;
};

/**
 * Builder for creating encrypted inputs.
 *
 * Use the add* methods to queue values for encryption, then call encrypt()
 * to get handles + proof. The order of add* calls determines the order of
 * handles in the result.
 */
interface RelayerEncryptedInput {
  /** Add encrypted boolean (ebool in contract) */
  addBool(value: boolean): void;
  /** Add encrypted uint8 (euint8 in contract) */
  add8(value: number): void;
  /** Add encrypted uint16 (euint16 in contract) */
  add16(value: number): void;
  /** Add encrypted uint32 (euint32 in contract) */
  add32(value: number): void;
  /** Add encrypted uint64 (euint64 in contract) - most common for amounts */
  add64(value: number | bigint): void;
  /** Add encrypted uint128 (euint128 in contract) */
  add128(value: number | bigint): void;
  /** Add encrypted uint256 (euint256 in contract) */
  add256(value: number | bigint): void;
  /** Add encrypted address (eaddress in contract) */
  addAddress(value: string): void;
  /** Encrypt all queued values and return handles + ZK proof */
  encrypt(): Promise<EncryptResult>;
}

interface UseFHEEncryptionParams {
  /** FHEVM SDK instance (from useFhevmSdk) */
  instance: FhevmInstance | undefined;
  /** User's wallet signer for deriving encryption context */
  ethersSigner: ethers.Signer | undefined;
  /** Target contract address - encryption is bound to this contract */
  contractAddress: `0x${string}` | undefined;
}

export const useFHEEncryption = (params: UseFHEEncryptionParams) => {
  const { instance, ethersSigner, contractAddress } = params;

  /** True when all dependencies are ready for encryption */
  const canEncrypt = useMemo(
    () => Boolean(instance && ethersSigner && contractAddress),
    [instance, ethersSigner, contractAddress]
  );

  /**
   * Encrypt values using a builder function.
   *
   * The encryption is bound to (contractAddress, userAddress) - this ensures
   * the encrypted value can only be used by this user with this contract.
   * The ACL (Access Control List) contract enforces this binding.
   *
   * @param buildFn - Function that adds values to encrypt via the builder
   * @returns EncryptResult with handles array and inputProof, or undefined if not ready
   */
  const encryptWith = useCallback(
    async (
      buildFn: (builder: RelayerEncryptedInput) => void
    ): Promise<EncryptResult | undefined> => {
      if (!(instance && ethersSigner && contractAddress)) {
        return;
      }

      // Encryption context is bound to user + contract for ACL enforcement
      const userAddress = await ethersSigner.getAddress();
      const input = instance.createEncryptedInput(
        contractAddress,
        userAddress
      ) as RelayerEncryptedInput;

      // Let caller add values to encrypt
      buildFn(input);

      // Encrypt all values and generate ZK proof of correct encryption
      const start = performance.now();
      let result: "ok" | "error" = "ok";
      try {
        const enc = await input.encrypt();
        recordClientMetric({
          name: "client.fhevm.encrypt.proof.bytes",
          value: enc.inputProof.byteLength,
        });
        return enc;
      } catch (error) {
        result = "error";
        throw error;
      } finally {
        recordClientMetric({
          name: "client.fhevm.encrypt.duration",
          value: performance.now() - start,
          attributes: { result },
        });
      }
    },
    [instance, ethersSigner, contractAddress]
  );

  return {
    canEncrypt,
    encryptWith,
  } as const;
};

/**
 * Build contract function parameters from encryption result using ABI.
 *
 * fhEVM contracts typically have functions like:
 * `transfer(bytes32 encryptedAmount, bytes calldata inputProof)`
 *
 * This helper converts EncryptResult to the correct parameter types
 * based on the function's ABI definition.
 *
 * @internal Not currently used - kept for potential future ABI-driven encryption
 */
const _buildParamsFromAbi = (
  enc: EncryptResult,
  abi: AbiItem[],
  functionName: string
): unknown[] => {
  const fn = abi.find(
    (item): item is AbiFunctionItem =>
      item.type === "function" && item.name === functionName
  );
  if (!fn) {
    throw new Error(`Function ABI not found for ${functionName}`);
  }

  return fn.inputs.map((input: AbiParameter, index: number) => {
    // First param is typically the handle, second is the proof
    const raw = index === 0 ? enc.handles[0] : enc.inputProof;
    switch (input.type) {
      case "bytes32":
      case "bytes":
        return toHex(raw);
      case "uint256":
        return BigInt(raw as unknown as string);
      case "address":
      case "string":
        return raw as unknown as string;
      case "bool":
        return Boolean(raw);
      default:
        return toHex(raw);
    }
  });
};
