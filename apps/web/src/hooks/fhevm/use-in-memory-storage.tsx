"use client";

/**
 * In-Memory Storage Provider for FHE Decryption Signatures
 *
 * Provides a React Context for storing decryption authorization signatures.
 *
 * ## What Gets Stored
 * FHE decryption requires user authorization via EIP-712 signatures.
 * These signatures:
 * - Are valid for 365 days
 * - Include an ephemeral keypair for re-encryption
 * - Are scoped to specific contracts
 *
 * To avoid prompting users to sign repeatedly, signatures are cached.
 *
 * ## Why In-Memory?
 * The signature includes a private key (for decrypting re-encrypted data).
 * In-memory storage:
 * - Clears on page refresh (security benefit)
 * - Avoids persisting sensitive keys to disk
 * - Is sufficient for single-session use
 *
 * ## Alternatives
 * For persistence across sessions, replace with:
 * - `localStorage` adapter (persists until cleared)
 * - `sessionStorage` adapter (persists until tab closes)
 * - `IndexedDB` adapter (for larger storage needs)
 *
 * All adapters implement `GenericStringStorage` interface.
 *
 * @example
 * ```tsx
 * // In app layout
 * <InMemoryStorageProvider>
 *   <App />
 * </InMemoryStorageProvider>
 *
 * // In component
 * const { storage } = useInMemoryStorage();
 * const { decrypt } = useFHEDecrypt({
 *   fhevmDecryptionSignatureStorage: storage,
 *   // ...
 * });
 * ```
 */
import { createContext, type ReactNode, useContext, useState } from "react";

import {
  GenericStringInMemoryStorage,
  type GenericStringStorage,
} from "@/lib/fhevm/storage/generic-string-storage";

interface UseInMemoryStorageState {
  /** Storage instance implementing GenericStringStorage interface */
  storage: GenericStringStorage;
}

interface InMemoryStorageProviderProps {
  children: ReactNode;
}

const InMemoryStorageContext = createContext<
  UseInMemoryStorageState | undefined
>(undefined);

/**
 * Access the in-memory storage for decryption signatures.
 * Must be used within InMemoryStorageProvider.
 */
export const useInMemoryStorage = () => {
  const context = useContext(InMemoryStorageContext);
  if (!context) {
    throw new Error(
      "useInMemoryStorage must be used within a InMemoryStorageProvider",
    );
  }
  return context;
};

/**
 * Provider that creates and shares a single storage instance.
 *
 * The storage is created once on mount and persists for the component's lifetime.
 * All child components share the same storage instance.
 */
export const InMemoryStorageProvider: React.FC<
  InMemoryStorageProviderProps
> = ({ children }) => {
  // useState with initializer function ensures storage is created only once
  const [storage] = useState<GenericStringStorage>(
    () => new GenericStringInMemoryStorage(),
  );

  return (
    <InMemoryStorageContext.Provider value={{ storage }}>
      {children}
    </InMemoryStorageContext.Provider>
  );
};
