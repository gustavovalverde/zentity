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

// --- Credential Caches ---
export {
  cacheOpaqueExportKey,
  cachePasskeyUnlock,
  clearAllCredentialCaches,
  clearPendingUnlock,
  getCachedOpaqueExportKey,
  getCachedOpaqueUserId,
  getCachedPasskeyPrfOutput,
  getCachedPasskeyUnlock,
  getCachedRecoveryKey,
  getPendingUnlock,
  hasAnyCachedCredential,
  hasAnyCachedOpaqueExport,
  hasCachedPasskeyUnlock,
  isOpaqueCacheFresh,
  resetOpaqueExportCache,
  resetPasskeyUnlockCache,
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
  cacheWalletSignature,
  decryptSecretWithWalletSignature,
  getCachedWalletSignature,
  getWalletCredentialId,
  isWalletCacheFresh,
  parseWalletCredentialId,
  resetWalletSignatureCache,
  signatureToBytes,
  unwrapDekWithWalletSignature,
  WALLET_CREDENTIAL_PREFIX,
  wrapDekWithWalletSignature,
} from "./wallet";
// --- DEK Wrapping ---
export { wrapDek } from "./wrap";
