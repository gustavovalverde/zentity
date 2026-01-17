/**
 * fhEVM Decryption Signature Management
 *
 * Manages EIP-712 signed sessions for user-controlled FHE decryption.
 *
 * ## Why Signatures for Decryption?
 * In fhEVM, encrypted data can only be decrypted by authorized users.
 * The user must sign an EIP-712 message to prove they want to decrypt.
 * This prevents unauthorized decryption of sensitive data.
 *
 * ## Session-Based Approach
 * Instead of signing for every decryption, we use sessions:
 * 1. User signs once, authorizing decryption for 365 days
 * 2. Session includes ephemeral keypair for re-encryption
 * 3. KMS re-encrypts data to user's ephemeral public key
 * 4. User decrypts locally with ephemeral private key
 *
 * ## Storage Key Strategy
 * Sessions are cached in storage with a key derived from:
 * - User address
 * - Contract addresses (sorted, checksummed)
 * - Optionally: public key (for keypair-specific lookups)
 *
 * This allows reusing signatures across page reloads while ensuring
 * different contract combinations get different signatures.
 *
 * @see https://eips.ethereum.org/EIPS/eip-712 for EIP-712 specification
 */

import type { GenericStringStorage } from "./storage/generic-string-storage";
import type {
  EIP712Type,
  FhevmDecryptionSignatureType,
  FhevmInstance,
} from "./types";

import { ethers } from "ethers";

/** Current Unix timestamp in seconds */
function timestampNow(): number {
  return Math.floor(Date.now() / 1000);
}

/** Type guard for non-null objects */
function isNonNullObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

/** Check if object has a string property */
function hasStringProp(obj: Record<string, unknown>, key: string): boolean {
  return key in obj && typeof obj[key] === "string";
}

/** Check if object has a number property */
function hasNumberProp(obj: Record<string, unknown>, key: string): boolean {
  return key in obj && typeof obj[key] === "number";
}

/** Validate contract addresses array */
function isValidContractAddresses(value: unknown): boolean {
  if (!Array.isArray(value)) {
    return false;
  }
  return value.every(
    (addr) => typeof addr === "string" && addr.startsWith("0x")
  );
}

/** Validate EIP-712 structure */
function isValidEIP712Structure(value: unknown): boolean {
  if (!isNonNullObject(value)) {
    return false;
  }
  return (
    "domain" in value &&
    typeof value.domain === "object" &&
    hasStringProp(value, "primaryType") &&
    "message" in value &&
    "types" in value &&
    isNonNullObject(value.types)
  );
}

/**
 * Normalize contract addresses for deterministic EIP-712 payloads.
 *
 * EIP-712 signatures are sensitive to exact message content. If addresses
 * are in different order or format, signature verification fails.
 * This ensures:
 * - Checksum format (0xAbC...123)
 * - Deduplicated (no duplicate contracts)
 * - Sorted alphabetically (deterministic ordering)
 */
function normalizeContractAddresses(
  contractAddresses: string[]
): `0x${string}`[] {
  const unique = new Set<string>();
  for (const addr of contractAddresses) {
    unique.add(ethers.getAddress(addr));
  }
  return [...unique].sort((a, b) =>
    a.toLowerCase().localeCompare(b.toLowerCase())
  ) as `0x${string}`[];
}

/**
 * Verify EIP-712 signature locally before sending to Gateway.
 *
 * This prevents sending invalid signatures to the relayer, which would
 * waste network requests and confuse error handling.
 */
function isSignatureValid(
  eip712: EIP712Type,
  signature: string,
  userAddress: string
): boolean {
  try {
    const recovered = ethers.verifyTypedData(
      eip712.domain,
      {
        UserDecryptRequestVerification:
          eip712.types.UserDecryptRequestVerification,
      },
      eip712.message,
      signature
    );
    return ethers.getAddress(recovered) === ethers.getAddress(userAddress);
  } catch {
    return false;
  }
}

/**
 * Build explicit EIP-712 v4 payload for wallet compatibility.
 *
 * Some wallets (e.g., MetaMask) require the explicit v4 format with
 * EIP712Domain type included. We try the standard ethers.js signTypedData
 * first, then fall back to this format if verification fails.
 */
function buildTypedDataV4Payload(eip712: EIP712Type) {
  return {
    domain: eip712.domain,
    primaryType: "UserDecryptRequestVerification",
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" },
      ],
      UserDecryptRequestVerification:
        eip712.types.UserDecryptRequestVerification,
    },
    message: eip712.message,
  };
}

/**
 * Generates deterministic storage keys for caching decryption signatures.
 *
 * The key is derived from:
 * - User address
 * - EIP-712 type hash (includes domain, contract addresses, public key)
 *
 * This ensures different users/contracts/keypairs get different cache entries.
 */
class FhevmDecryptionSignatureStorageKey {
  readonly #contractAddresses: `0x${string}`[];
  readonly #userAddress: `0x${string}`;
  readonly #publicKey: string | undefined;
  readonly #key: string;

  constructor(
    instance: FhevmInstance,
    contractAddresses: string[],
    userAddress: string,
    publicKey?: string
  ) {
    if (!ethers.isAddress(userAddress)) {
      throw new TypeError(`Invalid address ${userAddress}`);
    }

    const sortedContractAddresses =
      normalizeContractAddresses(contractAddresses);

    // Create a "dummy" EIP-712 to get the type structure hash
    // This hash uniquely identifies the (domain, contracts, key) combination
    const emptyEIP712 = instance.createEIP712(
      publicKey ?? ethers.ZeroAddress,
      sortedContractAddresses,
      0,
      0
    );

    // Hash the EIP-712 structure to create a compact, unique identifier
    const hash = ethers.TypedDataEncoder.hash(
      emptyEIP712.domain,
      {
        UserDecryptRequestVerification:
          emptyEIP712.types.UserDecryptRequestVerification,
      },
      emptyEIP712.message
    );

    this.#contractAddresses = sortedContractAddresses;
    this.#userAddress = userAddress as `0x${string}`;
    this.#publicKey = publicKey;
    this.#key = `${userAddress}:${hash}`;
  }

  get contractAddresses(): `0x${string}`[] {
    return this.#contractAddresses;
  }

  get userAddress(): `0x${string}` {
    return this.#userAddress;
  }

  get publicKey(): string | undefined {
    return this.#publicKey;
  }

  /** Storage key: "0xUser...:0xHash..." */
  get key(): string {
    return this.#key;
  }
}

/**
 * Immutable decryption authorization session.
 *
 * Contains everything needed for the Gateway/KMS to authorize decryption:
 * - EIP-712 signature proving user consent
 * - Ephemeral keypair for re-encryption
 * - Validity period
 * - Authorized contracts
 *
 * ## Usage Pattern
 * ```typescript
 * // Load cached or create new signature
 * const sig = await FhevmDecryptionSignature.loadOrSign(
 *   instance, contracts, signer, storage
 * );
 *
 * // Use in decryption
 * await instance.userDecrypt(
 *   requests,
 *   sig.privateKey,
 *   sig.publicKey,
 *   sig.signature,
 *   // ...
 * );
 * ```
 */
export class FhevmDecryptionSignature {
  readonly #publicKey: string;
  readonly #privateKey: string;
  readonly #signature: string;
  readonly #startTimestamp: number;
  readonly #durationDays: number;
  readonly #userAddress: `0x${string}`;
  readonly #contractAddresses: `0x${string}`[];
  readonly #eip712: EIP712Type;

  /** Private constructor - use static factory methods */
  private constructor(parameters: FhevmDecryptionSignatureType) {
    if (!FhevmDecryptionSignature.checkIs(parameters)) {
      throw new TypeError("Invalid FhevmDecryptionSignatureType");
    }
    this.#publicKey = parameters.publicKey;
    this.#privateKey = parameters.privateKey;
    this.#signature = parameters.signature;
    this.#startTimestamp = parameters.startTimestamp;
    this.#durationDays = parameters.durationDays;
    this.#userAddress = parameters.userAddress;
    this.#contractAddresses = parameters.contractAddresses;
    this.#eip712 = parameters.eip712;
  }

  /** Ephemeral private key for decrypting re-encrypted data */
  get privateKey() {
    return this.#privateKey;
  }

  /** Ephemeral public key - KMS re-encrypts to this */
  get publicKey() {
    return this.#publicKey;
  }

  /** User's EIP-712 signature authorizing decryption */
  get signature() {
    return this.#signature;
  }

  /** Contracts this signature authorizes decryption for */
  get contractAddresses() {
    return this.#contractAddresses;
  }

  /** When this authorization became valid (Unix seconds) */
  get startTimestamp() {
    return this.#startTimestamp;
  }

  /** How long authorization lasts (days) */
  get durationDays() {
    return this.#durationDays;
  }

  /** User wallet address that signed */
  get userAddress() {
    return this.#userAddress;
  }

  /** Type guard for validating signature data from storage */
  static checkIs(s: unknown): s is FhevmDecryptionSignatureType {
    if (!isNonNullObject(s)) {
      return false;
    }

    const hasRequiredStrings =
      hasStringProp(s, "publicKey") &&
      hasStringProp(s, "privateKey") &&
      hasStringProp(s, "signature");

    const hasRequiredNumbers =
      hasNumberProp(s, "startTimestamp") && hasNumberProp(s, "durationDays");

    if (!(hasRequiredStrings && hasRequiredNumbers)) {
      return false;
    }

    if (!isValidContractAddresses(s.contractAddresses)) {
      return false;
    }

    const hasValidUserAddress =
      hasStringProp(s, "userAddress") &&
      (s.userAddress as string).startsWith("0x");

    if (!hasValidUserAddress) {
      return false;
    }

    return isValidEIP712Structure(s.eip712);
  }

  /** Serialize for storage (JSON.stringify compatible) */
  toJSON() {
    return {
      publicKey: this.#publicKey,
      privateKey: this.#privateKey,
      signature: this.#signature,
      startTimestamp: this.#startTimestamp,
      durationDays: this.#durationDays,
      userAddress: this.#userAddress,
      contractAddresses: this.#contractAddresses,
      eip712: this.#eip712,
    };
  }

  /** Deserialize from storage */
  static fromJSON(json: unknown) {
    const data = typeof json === "string" ? JSON.parse(json) : json;
    return new FhevmDecryptionSignature(data);
  }

  /** Compare by signature (unique identifier) */
  equals(s: FhevmDecryptionSignatureType) {
    return s.signature === this.#signature;
  }

  /** Check if this session is still within its validity period */
  isValid(): boolean {
    return (
      timestampNow() < this.#startTimestamp + this.#durationDays * 24 * 60 * 60
    );
  }

  /**
   * Cache this signature to storage for reuse across page reloads.
   *
   * @param storage - Storage backend (localStorage, sessionStorage, etc.)
   * @param instance - FHEVM SDK instance (for key derivation)
   * @param withPublicKey - Include public key in storage key (for keypair-specific caching)
   */
  async saveToGenericStringStorage(
    storage: GenericStringStorage,
    instance: FhevmInstance,
    withPublicKey: boolean
  ) {
    try {
      const value = JSON.stringify(this);
      const storageKey = new FhevmDecryptionSignatureStorageKey(
        instance,
        this.#contractAddresses,
        this.#userAddress,
        withPublicKey ? this.#publicKey : undefined
      );
      await storage.setItem(storageKey.key, value);
    } catch {
      // Storage errors are non-fatal - worst case we re-sign next time
    }
  }

  /**
   * Load a cached signature from storage if valid.
   *
   * Returns null if:
   * - No cached signature exists
   * - Cached signature is expired
   * - Cached data is corrupted
   */
  static async loadFromGenericStringStorage(options: {
    storage: GenericStringStorage;
    instance: FhevmInstance;
    contractAddresses: string[];
    userAddress: string;
    publicKey?: string;
  }): Promise<FhevmDecryptionSignature | null> {
    const { storage, instance, contractAddresses, userAddress, publicKey } =
      options;
    try {
      const storageKey = new FhevmDecryptionSignatureStorageKey(
        instance,
        contractAddresses,
        userAddress,
        publicKey
      );
      const result = await storage.getItem(storageKey.key);

      if (!result) {
        return null;
      }

      try {
        const kps = FhevmDecryptionSignature.fromJSON(result);
        if (!kps.isValid()) {
          return null; // Expired - will be replaced with fresh signature
        }
        return kps;
      } catch {
        return null; // Corrupted data
      }
    } catch {
      return null;
    }
  }

  /**
   * Remove cached signature from storage.
   *
   * Used when a signature becomes invalid (e.g., Gateway rejects it)
   * to force re-signing on next decryption attempt.
   */
  static async clearFromGenericStringStorage(options: {
    storage: GenericStringStorage;
    instance: FhevmInstance;
    contractAddresses: string[];
    userAddress: string;
    publicKey?: string;
  }): Promise<void> {
    const { storage, instance, contractAddresses, userAddress, publicKey } =
      options;
    try {
      const storageKey = new FhevmDecryptionSignatureStorageKey(
        instance,
        contractAddresses,
        userAddress,
        publicKey
      );
      await storage.removeItem(storageKey.key);
    } catch {
      // Storage errors are non-fatal
    }
  }

  /**
   * Create a new decryption signature by prompting user to sign.
   *
   * Flow:
   * 1. Build EIP-712 typed data with contracts and keypair
   * 2. Request signature from wallet
   * 3. Verify signature locally
   * 4. Return signature if valid, null if user rejected or verification failed
   */
  static async new(options: {
    /** FHEVM SDK instance */
    instance: FhevmInstance;
    /** Contracts to authorize decryption for */
    contractAddresses: string[];
    /** Ephemeral public key for re-encryption */
    publicKey: string;
    /** Ephemeral private key for local decryption */
    privateKey: string;
    /** Wallet signer to request signature from */
    signer: ethers.Signer;
  }): Promise<FhevmDecryptionSignature | null> {
    const { instance, contractAddresses, publicKey, privateKey, signer } =
      options;
    try {
      const userAddress = (await signer.getAddress()) as `0x${string}`;
      const startTimestamp = timestampNow();
      const durationDays = 365;

      const normalizedContractAddresses =
        normalizeContractAddresses(contractAddresses);

      // Build EIP-712 message for the KMS to verify
      const eip712 = instance.createEIP712(
        publicKey,
        normalizedContractAddresses,
        startTimestamp,
        durationDays
      );

      // Try standard ethers.js signTypedData first
      let signature = await signer.signTypedData(
        eip712.domain,
        {
          UserDecryptRequestVerification:
            eip712.types.UserDecryptRequestVerification,
        },
        eip712.message
      );

      // Some wallets need explicit v4 format - try fallback if verification fails
      if (!isSignatureValid(eip712, signature, userAddress)) {
        const provider = signer.provider;
        if (provider && "send" in provider) {
          const rpcProvider = provider as {
            send: (method: string, params: unknown[]) => Promise<unknown>;
          };
          const payload = buildTypedDataV4Payload(eip712);
          const maybeSignature = await rpcProvider.send(
            "eth_signTypedData_v4",
            [userAddress, JSON.stringify(payload)]
          );
          if (typeof maybeSignature === "string") {
            signature = maybeSignature;
          }
        }
      }

      // Final verification - if still invalid, user likely rejected
      if (!isSignatureValid(eip712, signature, userAddress)) {
        return null;
      }

      return new FhevmDecryptionSignature({
        publicKey,
        privateKey,
        contractAddresses: normalizedContractAddresses,
        startTimestamp,
        durationDays,
        signature,
        eip712,
        userAddress,
      });
    } catch {
      return null; // User rejected or wallet error
    }
  }

  /**
   * Load cached signature or create new one if needed.
   *
   * This is the main entry point for decryption authorization:
   * 1. Check storage for valid cached signature
   * 2. If found and valid, return it (no user interaction)
   * 3. If not found/expired, generate keypair and prompt user to sign
   * 4. Cache the new signature for future use
   */
  static async loadOrSign(options: {
    /** FHEVM SDK instance */
    instance: FhevmInstance;
    /** Contracts to authorize decryption for */
    contractAddresses: string[];
    /** Wallet signer */
    signer: ethers.Signer;
    /** Storage backend for caching */
    storage: GenericStringStorage;
    /** Optional pre-generated keypair (otherwise generated fresh) */
    keyPair?: { publicKey: string; privateKey: string };
  }): Promise<FhevmDecryptionSignature | null> {
    const { instance, contractAddresses, signer, storage, keyPair } = options;
    const userAddress = (await signer.getAddress()) as `0x${string}`;

    // Try to load from cache first (no user interaction if found)
    const cached: FhevmDecryptionSignature | null =
      await FhevmDecryptionSignature.loadFromGenericStringStorage({
        storage,
        instance,
        contractAddresses,
        userAddress,
        publicKey: keyPair?.publicKey,
      });

    if (cached) {
      return cached;
    }

    // Generate fresh keypair if not provided
    const { publicKey, privateKey } = keyPair ?? instance.generateKeypair();

    // Prompt user to sign (wallet popup)
    const sig = await FhevmDecryptionSignature.new({
      instance,
      contractAddresses,
      publicKey,
      privateKey,
      signer,
    });

    if (!sig) {
      return null;
    }

    // Cache for future use
    await sig.saveToGenericStringStorage(
      storage,
      instance,
      Boolean(keyPair?.publicKey)
    );

    return sig;
  }
}
