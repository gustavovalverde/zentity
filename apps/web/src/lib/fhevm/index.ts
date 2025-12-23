/**
 * fhEVM Client-Side Integration
 *
 * Provides React hooks and utilities for interacting with an fhEVM network.
 * Enables client-side encryption and user-controlled decryption.
 */

// Types
export type {
  EIP712Type,
  EncryptResult,
  FHEDecryptRequest,
  FhevmDecryptionSignatureType,
  FhevmGoState,
  FhevmInstance,
} from "./types";

// React hooks
export {
  InMemoryStorageProvider,
  toHex,
  useFHEDecrypt,
  useFHEEncryption,
  useFhevmSdk,
  useInMemoryStorage,
} from "@/hooks/fhevm";

// Core classes
export { FhevmDecryptionSignature } from "./fhevm-decryption-signature";
// Provider registry (multi-vendor FHEVM support)
export {
  type FhevmProviderFactory,
  type FhevmProviderId,
  registerFhevmProvider,
  resolveFhevmProviderFactory,
} from "./providers";
// Storage
export {
  GenericStringInMemoryStorage,
  type GenericStringStorage,
} from "./storage";
