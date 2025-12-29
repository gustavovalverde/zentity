/**
 * Database Module - Server-Only
 *
 * IMPORTANT: This module is SERVER-ONLY and should only be imported
 * in server components, API routes, or server actions.
 */

export type { EncryptedPiiData, OnboardingStep } from "./onboarding-session";

export {
  db,
  getDefaultDatabasePath,
  getSqliteDb,
  sqlite,
} from "./connection";
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
export * from "./queries";
export * from "./schema";
