/**
 * Database Module - Server-Only
 *
 * IMPORTANT: This module is SERVER-ONLY and should only be imported
 * in server components, API routes, or server actions.
 *
 * All exports use SQLite via bun:sqlite or next/headers and cannot
 * be used in client components.
 */

// Identity proofs
// Onboarding sessions
// RP authorization codes

export type {
  AttestationStatus,
  BlockchainAttestation,
} from "./db";
// Onboarding session management (uses next/headers)
export type {
  EncryptedPiiData,
  OnboardingStep,
} from "./onboarding-session";

export {
  cleanupExpiredOnboardingSessions,
  consumeRpAuthorizationCode,
  // Blockchain attestations
  createBlockchainAttestation,
  createIdentityProof,
  createRpAuthorizationCode,
  deleteAgeProofs,
  deleteBlockchainAttestationsByUserId,
  deleteIdentityProof,
  deleteOnboardingSession,
  documentHashExists,
  encryptFirstName,
  getBlockchainAttestationByUserAndNetwork,
  getBlockchainAttestationsByUserId,
  getIdentityProofByUserId,
  getUserAgeProof,
  getUserAgeProofPayload,
  getUserFirstName,
  getVerificationStatus,
  resetBlockchainAttestationForRetry,
  updateBlockchainAttestationConfirmed,
  updateBlockchainAttestationFailed,
  updateBlockchainAttestationSubmitted,
  updateBlockchainAttestationWallet,
  updateIdentityProofFlags,
  updateUserName,
} from "./db";
export {
  clearWizardCookie,
  completeOnboarding,
  getSessionFromCookie,
  loadWizardState,
  resetToStep,
  saveWizardState,
  skipLiveness,
  updateWizardProgress,
  validateStepAccess,
} from "./onboarding-session";
// SQLite utilities
export {
  getDefaultDatabasePath,
  getSqliteDb,
  isSqliteBuildTime,
} from "./sqlite";
