/**
 * Onboarding Session Management
 *
 * Handles secure storage of wizard state using:
 * - jose JWE for encrypting sensitive PII before database storage
 * - SQLite for server-side session persistence
 * - Encrypted cookies for stateless wizard navigation (stores sessionId)
 *
 * Security model:
 * - Sessions are keyed by random sessionId, NOT email
 * - PII is encrypted with AES-256-GCM before storage
 * - Only sessionId + step stored in navigation cookie
 * - Sensitive data (documents, selfies) never stored - processed in real-time
 */

import type { OnboardingSession } from "./schema";

import { EncryptJWT, jwtDecrypt } from "jose";
import { cookies } from "next/headers";

import { addSpanEvent, hashIdentifier } from "@/lib/observability";
import { getBetterAuthSecret } from "@/lib/utils/env";

import {
  deleteOnboardingSessionById,
  getOnboardingSessionById,
  upsertOnboardingSession,
} from "./queries/onboarding";

/**
 * Get encryption secret from environment (same as better-auth)
 *
 * AES-256-GCM requires exactly 256 bits (32 bytes).
 * We derive a fixed-length key from the secret using SHA-256.
 */
const getSecret = async (): Promise<Uint8Array> => {
  const secret = getBetterAuthSecret();

  // Derive a 256-bit key from the secret using SHA-256
  const encoder = new TextEncoder();
  const data = encoder.encode(secret);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return new Uint8Array(hashBuffer);
};

const WIZARD_COOKIE_NAME = "zentity-wizard";
const SESSION_TTL_SECONDS = 30 * 60; // 30 minutes

/**
 * PII data that gets encrypted before storage
 */
export interface EncryptedPiiData {
  extractedName?: string;
  extractedDOB?: string;
  extractedDocNumber?: string;
  extractedNationality?: string;
}

/**
 * Wizard navigation state (stored in cookie)
 * Now uses sessionId instead of email as the key
 */
interface WizardNavState {
  sessionId: string;
  step: number;
}

/**
 * Full wizard state (combined from cookie + database)
 */
interface FullWizardState {
  sessionId: string;
  email: string | null;
  step: number;
  pii?: EncryptedPiiData;
  identityDraftId?: string | null;
  documentProcessed: boolean;
  livenessPassed: boolean;
  faceMatchPassed: boolean;
  keysSecured: boolean;
}

/**
 * Result of loading wizard state, includes whether a stale session was cleared
 */
interface WizardStateResult {
  state: FullWizardState | null;
  /** True if a stale cookie was cleared (cookie existed but DB session was missing/expired) */
  wasCleared: boolean;
}

/**
 * Encrypt PII data using jose JWE (AES-256-GCM)
 */
async function encryptPii(pii: EncryptedPiiData): Promise<string> {
  const secret = await getSecret();

  const token = await new EncryptJWT({ pii })
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .encrypt(secret);

  return token;
}

/**
 * Decrypt PII data from JWE token
 */
async function decryptPii(token: string): Promise<EncryptedPiiData | null> {
  try {
    const secret = await getSecret();
    const { payload } = await jwtDecrypt(token, secret);
    return (payload.pii as EncryptedPiiData) || null;
  } catch {
    // Token expired or invalid
    return null;
  }
}

/**
 * Set wizard navigation cookie (sessionId + step only)
 */
async function setWizardCookie(state: WizardNavState): Promise<void> {
  const secret = await getSecret();

  const token = await new EncryptJWT({
    sessionId: state.sessionId,
    step: state.step,
  })
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .encrypt(secret);

  const cookieStore = await cookies();
  // Only set Secure flag when using HTTPS. This allows running production builds
  // on localhost over HTTP for testing (e.g., docker-compose with NODE_ENV=production).
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "";
  const isHttps = appUrl.startsWith("https://");
  const useSecureCookie = process.env.NODE_ENV === "production" && isHttps;

  cookieStore.set(WIZARD_COOKIE_NAME, token, {
    httpOnly: true,
    secure: useSecureCookie,
    sameSite: "lax",
    maxAge: SESSION_TTL_SECONDS,
    path: "/",
  });
}

/**
 * Get wizard navigation state from cookie
 */
async function getWizardCookie(): Promise<WizardNavState | null> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(WIZARD_COOKIE_NAME)?.value;
    if (!token) return null;

    const secret = await getSecret();
    const { payload } = await jwtDecrypt(token, secret);

    return {
      sessionId: payload.sessionId as string,
      step: payload.step as number,
    };
  } catch {
    return null;
  }
}

/**
 * Clear wizard cookie
 */
export async function clearWizardCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(WIZARD_COOKIE_NAME);
}

/**
 * Save wizard state (combines cookie + database storage)
 *
 * @param sessionId - Session ID (generated if not provided)
 * @param state - Wizard state to save (email, step)
 * @param pii - Optional PII data to encrypt and store
 * @returns The session including its ID
 */
export async function saveWizardState(
  sessionId: string | undefined,
  state: { email?: string; step: number },
  pii?: EncryptedPiiData,
): Promise<OnboardingSession> {
  // Encrypt PII if provided
  let encryptedPii: string | null = null;
  if (pii && Object.keys(pii).length > 0) {
    encryptedPii = await encryptPii(pii);
  }

  // Save to database (generates sessionId if not provided)
  const session = upsertOnboardingSession({
    id: sessionId,
    email: state.email,
    step: state.step,
    encryptedPii,
  });

  // Set navigation cookie with sessionId
  await setWizardCookie({ sessionId: session.id, step: state.step });

  return session;
}

/**
 * Load full wizard state (from cookie + database)
 *
 * Returns both the state and whether a stale cookie was cleared,
 * allowing callers to show appropriate feedback to users.
 */
export async function loadWizardState(): Promise<WizardStateResult> {
  // Get navigation state from cookie
  const navState = await getWizardCookie();
  if (!navState) {
    return { state: null, wasCleared: false };
  }

  // Get full session from database by sessionId
  const session = getOnboardingSessionById(navState.sessionId);
  if (!session) {
    // Cookie exists but session expired/missing in DB - clear stale cookie
    await clearWizardCookie();
    return { state: null, wasCleared: true };
  }

  // Decrypt PII if present
  let pii: EncryptedPiiData | undefined;
  if (session.encryptedPii) {
    const decrypted = await decryptPii(session.encryptedPii);
    if (decrypted) {
      pii = decrypted;
    }
  }

  return {
    state: {
      sessionId: session.id,
      email: session.email,
      step: session.step,
      pii,
      identityDraftId: session.identityDraftId ?? null,
      documentProcessed: session.documentProcessed,
      livenessPassed: session.livenessPassed,
      faceMatchPassed: session.faceMatchPassed,
      keysSecured: session.keysSecured,
    },
    wasCleared: false,
  };
}

/**
 * Update wizard step and verification flags
 */
export async function updateWizardProgress(
  sessionId: string,
  updates: {
    email?: string;
    step?: number;
    documentProcessed?: boolean;
    livenessPassed?: boolean;
    faceMatchPassed?: boolean;
    keysSecured?: boolean;
    documentHash?: string;
    identityDraftId?: string | null;
  },
): Promise<void> {
  const previousSession = getOnboardingSessionById(sessionId);
  const previousStep = previousSession?.step ?? null;
  const inferredStep = updates.step ?? (updates.keysSecured ? 5 : null);
  const step = inferredStep ?? undefined;

  // Update database
  upsertOnboardingSession({
    id: sessionId,
    ...updates,
    step,
  });

  addSpanEvent("onboarding.progress", {
    onboarding_step_previous: previousStep ?? undefined,
    onboarding_step: step ?? previousStep ?? undefined,
    onboarding_regression:
      typeof previousStep === "number" && typeof step === "number"
        ? step < previousStep
        : undefined,
    onboarding_replay:
      typeof previousStep === "number" && typeof step === "number"
        ? step === previousStep
        : undefined,
    onboarding_document_processed: updates.documentProcessed ?? undefined,
    onboarding_liveness_passed: updates.livenessPassed ?? undefined,
    onboarding_face_match_passed: updates.faceMatchPassed ?? undefined,
    onboarding_keys_secured: updates.keysSecured ?? undefined,
    onboarding_draft_id_hash: updates.identityDraftId
      ? hashIdentifier(updates.identityDraftId)
      : undefined,
  });

  // Update cookie if step changed
  if (step !== undefined) {
    await setWizardCookie({ sessionId, step });
  }
}

/**
 * Complete onboarding - delete session data
 */
export async function completeOnboarding(sessionId: string): Promise<void> {
  deleteOnboardingSessionById(sessionId);
  addSpanEvent("onboarding.complete", {});
  await clearWizardCookie();
}

// ============================================================================
// STEP VALIDATION SYSTEM
// ============================================================================

/**
 * Valid onboarding step numbers
 */
export type OnboardingStep = 1 | 2 | 3 | 4 | 5;

/**
 * Requirements for accessing a specific API endpoint
 */
interface StepRequirements {
  minStep: OnboardingStep;
  requiredFields?: Array<
    "documentProcessed" | "livenessPassed" | "faceMatchPassed" | "keysSecured"
  >;
}

/**
 * Step requirements for each protected API endpoint
 *
 * Step flow:
 * 1. Email entry (creates session)
 * 2. Document upload (requires step 1)
 * 3. Liveness check (requires step 2, can be skipped)
 * 4. Create account (requires steps 1-2, step 3 complete OR skipped)
 * 5. Secure keys (requires step 4)
 */
const STEP_REQUIREMENTS: Record<string, StepRequirements> = {
  "process-document": { minStep: 1 },
  "liveness-session": { minStep: 2, requiredFields: ["documentProcessed"] },
  "liveness-verify": { minStep: 2, requiredFields: ["documentProcessed"] },
  "skip-liveness": { minStep: 2, requiredFields: ["documentProcessed"] },
  "face-match": { minStep: 2, requiredFields: ["documentProcessed"] },
  // Complete requires document, liveness can be verified OR skipped
  complete: {
    minStep: 5,
    requiredFields: ["documentProcessed", "keysSecured"],
  },
  "identity-verify": {
    minStep: 4,
    requiredFields: ["documentProcessed", "keysSecured"],
  },
  "identity-finalize": {
    minStep: 4,
    requiredFields: ["documentProcessed", "keysSecured"],
  },
};

/**
 * Validation result for step access
 */
interface StepValidationResult {
  valid: boolean;
  error?: string;
  session?: OnboardingSession;
}

/**
 * Validate that the current session has permission to access an endpoint
 *
 * @param session - Current onboarding session (or null if none)
 * @param endpoint - The endpoint identifier (e.g., 'process-document')
 * @returns Validation result with error message if invalid
 */
export function validateStepAccess(
  session: OnboardingSession | null,
  endpoint: string,
): StepValidationResult {
  // Check session exists
  if (!session) {
    return {
      valid: false,
      error: "No active onboarding session. Please start from the beginning.",
    };
  }

  // Get requirements for this endpoint
  const requirements = STEP_REQUIREMENTS[endpoint];
  if (!requirements) {
    // No requirements defined, allow access
    return { valid: true, session };
  }

  // Check minimum step
  if (session.step < requirements.minStep) {
    return {
      valid: false,
      error: `Please complete step ${requirements.minStep - 1} first.`,
    };
  }

  // Check required fields
  if (requirements.requiredFields) {
    for (const field of requirements.requiredFields) {
      if (!session[field]) {
        const fieldName = field.replace(/([A-Z])/g, " $1").toLowerCase();
        return {
          valid: false,
          error: `Required verification not completed: ${fieldName}.`,
        };
      }
    }
  }

  return { valid: true, session };
}

/**
 * Get session from wizard cookie for API route validation
 * Returns the full session data if valid cookie exists
 */
export async function getSessionFromCookie(): Promise<OnboardingSession | null> {
  const navState = await getWizardCookie();
  if (!navState) return null;

  const session = getOnboardingSessionById(navState.sessionId);
  if (!session) {
    // Cookie exists but session expired/missing in DB
    await clearWizardCookie();
    return null;
  }

  return session;
}

/**
 * Reset session progress to a specific step
 * Clears all verification flags from the target step forward
 *
 * @param sessionId - Session ID
 * @param targetStep - Step to reset to (1-5)
 */
export async function resetToStep(
  sessionId: string,
  targetStep: OnboardingStep,
): Promise<void> {
  const updates: {
    step: number;
    documentProcessed?: boolean;
    livenessPassed?: boolean;
    faceMatchPassed?: boolean;
    keysSecured?: boolean;
    identityDraftId?: string | null;
  } = { step: targetStep };

  // Reset verification flags based on target step
  if (targetStep <= 1) {
    // Going back to step 1 resets everything
    updates.documentProcessed = false;
    updates.livenessPassed = false;
    updates.faceMatchPassed = false;
    updates.identityDraftId = null;
  } else if (targetStep <= 2) {
    // Going back to step 2 resets liveness and face match
    updates.livenessPassed = false;
    updates.faceMatchPassed = false;
    updates.identityDraftId = null;
  }
  if (targetStep <= 4) {
    updates.keysSecured = false;
  }
  // Step 3+ doesn't reset anything else (liveness is the last verification)

  await updateWizardProgress(sessionId, updates);
}

/**
 * Mark liveness as skipped (alternative to completing liveness verification)
 *
 * @param sessionId - Session ID
 */
export async function skipLiveness(sessionId: string): Promise<void> {
  await updateWizardProgress(sessionId, {
    // Skip step 3 (liveness challenges) and proceed to the final review step.
    step: 4,
  });
}
