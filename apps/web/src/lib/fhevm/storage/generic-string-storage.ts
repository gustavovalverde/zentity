/**
 * Generic String Storage Interface
 *
 * Abstraction for key-value storage used by FHE decryption signatures.
 *
 * ## Purpose
 * FHE decryption requires EIP-712 signatures that are valid for extended periods
 * (365 days). To avoid prompting users to sign repeatedly, these signatures
 * are cached in storage. This interface allows different storage backends.
 *
 * ## What Gets Stored
 * - Key: `${userAddress}:${eip712TypeHash}` - unique per user/contracts combo
 * - Value: JSON serialized FhevmDecryptionSignatureType (includes ephemeral keypair)
 *
 * ## Security Considerations
 * The stored data includes an ephemeral private key. Choose storage based on
 * your security requirements:
 * - **In-memory**: Clears on refresh, most secure (default)
 * - **sessionStorage**: Persists until tab closes
 * - **localStorage**: Persists indefinitely (use with caution)
 *
 * ## Implementations
 * - `GenericStringInMemoryStorage` - In-memory Map (clears on refresh)
 * - Custom: Implement interface with localStorage, IndexedDB, etc.
 */
export interface GenericStringStorage {
  /** Retrieve value by key. Returns null if not found. */
  getItem(key: string): string | Promise<string | null> | null;
  /** Store value at key. */
  setItem(key: string, value: string): void | Promise<void>;
  /** Remove value at key. */
  removeItem(key: string): void | Promise<void>;
}

/**
 * In-memory implementation using Map.
 *
 * Data is lost on page refresh - this is intentional for security.
 * Users will need to re-sign for decryption after refresh.
 */
export class GenericStringInMemoryStorage implements GenericStringStorage {
  readonly #store = new Map<string, string>();

  getItem(key: string): string | Promise<string | null> | null {
    return this.#store.has(key) ? (this.#store.get(key) as string) : null;
  }

  setItem(key: string, value: string): void | Promise<void> {
    this.#store.set(key, value);
  }

  removeItem(key: string): void | Promise<void> {
    this.#store.delete(key);
  }
}
