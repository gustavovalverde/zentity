/**
 * fhEVM Type Definitions
 *
 * Types for Fully Homomorphic Encryption (FHE) operations on EVM chains.
 *
 * FHE allows computations on encrypted data without decryption. In fhEVM:
 * - Values are encrypted client-side before sending to smart contracts
 * - Contracts operate on encrypted values (euint64, ebool, etc.)
 * - Only authorized users can decrypt their data via signed requests
 *
 * @see https://docs.zama.org for documentation
 */

/**
 * Encrypted input builder returned by `createEncryptedInput`.
 */
export interface FhevmEncryptedInput {
  addBool(value: boolean): void;
  add8(value: number): void;
  add16(value: number): void;
  add32(value: number): void;
  add64(value: number | bigint): void;
  add128(value: number | bigint): void;
  add256(value: number | bigint): void;
  addAddress(value: string): void;
  encrypt(): Promise<EncryptResult>;
}

/**
 * Core fhEVM SDK instance for FHE operations.
 *
 * Provider adapters (e.g., Zama relayer SDK, mock relayer) must implement
 * this interface so the app can remain vendor-agnostic.
 */
export interface FhevmInstance {
  /**
   * Create an encrypted input builder bound to (contract, user).
   */
  createEncryptedInput(
    contractAddress: string,
    userAddress: string,
  ): FhevmEncryptedInput;

  /**
   * Decrypt encrypted handles with user authorization.
   */
  userDecrypt(
    requests: { handle: string; contractAddress: string }[],
    privateKey: string,
    publicKey: string,
    signature: string,
    contractAddresses: string[],
    userAddress: string,
    startTimestamp: number | string,
    durationDays: number | string,
  ): Promise<Record<string, string | bigint | boolean>>;

  /**
   * Create EIP-712 typed data for signing decryption authorization.
   *
   * @param publicKey - User's ephemeral public key for re-encryption
   * @param contractAddresses - Contracts user wants to decrypt data from
   * @param startTimestamp - When this authorization becomes valid (Unix seconds)
   * @param durationDays - How long authorization is valid (e.g., 365 days)
   */
  createEIP712(
    publicKey: string,
    contractAddresses: string[],
    startTimestamp: number | string,
    durationDays: number | string,
  ): EIP712Type;
  /**
   * Generate ephemeral keypair for re-encryption.
   * The KMS re-encrypts data to this public key, only the private key holder can decrypt.
   */
  generateKeypair(): { publicKey: string; privateKey: string };
}

/**
 * Decryption authorization session data.
 *
 * When a user wants to decrypt their on-chain data:
 * 1. SDK generates an ephemeral keypair (publicKey/privateKey)
 * 2. User signs EIP-712 message authorizing decryption
 * 3. This signature + keypair can be reused for `durationDays`
 *
 * The signature authorizes the Gateway/KMS to re-encrypt data to the
 * user's ephemeral public key. Only the private key holder can then decrypt.
 */
export type FhevmDecryptionSignatureType = {
  /** Ephemeral public key - KMS re-encrypts data to this key */
  publicKey: string;
  /** Ephemeral private key - used to decrypt re-encrypted data locally */
  privateKey: string;
  /** User's EIP-712 signature authorizing decryption */
  signature: string;
  /** When authorization starts (Unix seconds) */
  startTimestamp: number;
  /** How long authorization is valid (typically 365 days) */
  durationDays: number;
  /** User's wallet address that signed the authorization */
  userAddress: `0x${string}`;
  /** Contracts this authorization covers */
  contractAddresses: `0x${string}`[];
  /** Full EIP-712 typed data that was signed */
  eip712: EIP712Type;
};

/**
 * EIP-712 typed structured data for wallet signing.
 *
 * EIP-712 provides a standard way to sign typed data that:
 * - Shows human-readable info in the wallet
 * - Prevents signature reuse across different dApps (via domain)
 * - Enables structured message verification on-chain
 *
 * @see https://eips.ethereum.org/EIPS/eip-712
 */
export type EIP712Type = {
  /** Domain separator - prevents cross-dApp signature reuse */
  domain: {
    chainId: number;
    name: string;
    /** KMS contract that verifies this signature */
    verifyingContract: string;
    version: string;
  };
  /** Actual message content being signed */
  message: Record<string, unknown>;
  /** Top-level type name in the types schema */
  primaryType: string;
  /** Type definitions for structured data */
  types: {
    [key: string]: {
      name: string;
      type: string;
    }[];
  };
};

/**
 * SDK initialization states.
 *
 * - idle: Not started
 * - loading: WASM loading or SDK initializing
 * - ready: SDK ready for encrypt/decrypt operations
 * - error: Initialization failed
 */
export type FhevmGoState = "idle" | "loading" | "ready" | "error";

/**
 * Request to decrypt an encrypted value stored on-chain.
 *
 * In fhEVM, encrypted values are stored as "handles" - 256-bit references
 * to the actual ciphertext stored in the KMS. To decrypt:
 * 1. Read the handle from the contract
 * 2. Pass handle + contract address to userDecrypt()
 * 3. Gateway verifies user's signature and returns decrypted value
 */
export type FHEDecryptRequest = {
  /**
   * 256-bit handle referencing the encrypted value.
   * This is what contracts store instead of actual ciphertext.
   */
  handle: string;
  /** Contract address where the encrypted value is stored */
  contractAddress: `0x${string}`;
};

/**
 * Result from encrypting values for a smart contract.
 *
 * When sending encrypted values to a contract:
 * 1. Client encrypts values using `createEncryptedInput()`
 * 2. Result contains handles (references) + proof (ZK validity proof)
 * 3. Contract receives handle + proof, stores the handle
 * 4. InputVerifier contract validates the proof
 */
export type EncryptResult = {
  /**
   * Handles (references) for each encrypted value.
   * These get stored on-chain, actual ciphertexts go to KMS.
   */
  handles: Uint8Array[];
  /**
   * Zero-knowledge proof that encryption was performed correctly.
   * InputVerifier contract validates this before accepting the handle.
   */
  inputProof: Uint8Array;
};
