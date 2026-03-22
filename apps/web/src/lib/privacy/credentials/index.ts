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
  getCachedRecoveryPublicKey,
  getPendingUnlock,
  setCachedRecoveryPublicKey,
  setPendingUnlock,
} from "./cache";
// --- KEK Derivation ---
export { generatePrfSalt } from "./derivation";
// --- OPAQUE ---
export {
  createOpaqueWrapper,
  OPAQUE_CREDENTIAL_ID,
  unwrapDekWithOpaqueExport,
  wrapDekWithOpaqueExport,
} from "./opaque";
// --- Passkey ---
export { unwrapDekWithPrf, wrapDekWithPrf } from "./passkey";
// --- Wallet ---
export {
  buildKekSignatureTypedData,
  getWalletCredentialId,
  signatureToBytes,
  unwrapDekWithWalletSignature,
  WALLET_CREDENTIAL_PREFIX,
  wrapDekWithWalletSignature,
} from "./wallet";
