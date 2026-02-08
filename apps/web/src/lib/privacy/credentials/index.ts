/**
 * Credentials Module
 *
 * Credential-specific KEK (Key Encryption Key) derivation and DEK wrapping.
 * Supports three credential types:
 * - Passkey: WebAuthn PRF-based key derivation
 * - OPAQUE: Password-based PAKE protocol key derivation
 * - Wallet: EIP-712 signature-based key derivation
 *
 * Each credential type derives a KEK from its specific material and uses
 * that KEK to wrap/unwrap Data Encryption Keys (DEKs).
 */

// --- Pending unlock deduplication & recovery key cache ---
export {
  clearAllCredentialCaches,
  clearPendingUnlock,
  getCachedRecoveryKey,
  getPendingUnlock,
  setCachedRecoveryKey,
  setPendingUnlock,
} from "./cache";
// --- KEK Derivation ---
export {
  deriveKekFromOpaqueExport,
  deriveKekFromPrf,
  deriveKekFromWalletSignature,
  generatePrfSalt,
} from "./derivation";
// --- OPAQUE ---
export {
  createOpaqueWrapper,
  decryptSecretWithOpaqueExport,
  OPAQUE_CREDENTIAL_ID,
  unwrapDekWithOpaqueExport,
  wrapDekWithOpaqueExport,
} from "./opaque";
// --- Passkey ---
export {
  createSecretEnvelope,
  unwrapDekWithPrf,
  wrapDekWithPrf,
} from "./passkey";
// --- Wallet ---
export {
  buildKekSignatureTypedData,
  decryptSecretWithWalletSignature,
  getWalletCredentialId,
  signatureToBytes,
  unwrapDekWithWalletSignature,
  WALLET_CREDENTIAL_PREFIX,
  wrapDekWithWalletSignature,
} from "./wallet";
