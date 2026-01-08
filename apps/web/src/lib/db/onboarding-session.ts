/**
 * Onboarding Session Management
 *
 * Handles wizard state using:
 * - SQLite for server-side session persistence
 * - Encrypted cookies for stateless wizard navigation (stores sessionId)
 *
 * Security model:
 * - Sessions are keyed by random sessionId (no email stored server-side)
 * - Only sessionId + step stored in navigation cookie
 * - Sensitive data (documents, selfies) never stored - processed in real-time
 */

import type { OnboardingSession } from "./schema/onboarding";

import { EncryptJWT, jwtDecrypt } from "jose";
import { cookies } from "next/headers";

import { addSpanEvent, hashIdentifier } from "@/lib/observability/telemetry";
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

/** Parses a raw Cookie header into a key/value map. */
function parseCookieHeader(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of raw.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (!key) {
      continue;
    }
    const value = rest.join("=");
    if (!value) {
      continue;
    }
    out[key] = value;
  }
  return out;
}

/**
 * Wizard navigation state (stored in cookie)
 * Session cookie stores only sessionId + step
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
  step: number;
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
 * Set wizard cookie.
 *
 * IMPORTANT: When called from tRPC handlers, you MUST pass resHeaders from ctx.
 * The Next.js cookies() API doesn't work in tRPC's fetch adapter context.
 * See: src/app/api/trpc/__tests__/route.test.ts for details.
 */
async function setWizardCookie(
  state: WizardNavState,
  resHeaders?: Headers
): Promise<void> {
  const secret = await getSecret();

  const token = await new EncryptJWT({
    sessionId: state.sessionId,
    step: state.step,
  })
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .encrypt(secret);

  // Only set Secure flag when using HTTPS. This allows running production builds
  // on localhost over HTTP for testing (e.g., docker-compose with NODE_ENV=production).
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "";
  const isHttps = appUrl.startsWith("https://");
  const useSecureCookie = process.env.NODE_ENV === "production" && isHttps;

  const cookieValue = [
    `${WIZARD_COOKIE_NAME}=${token}`,
    "HttpOnly",
    useSecureCookie ? "Secure" : "",
    "SameSite=Lax",
    `Max-Age=${SESSION_TTL_SECONDS}`,
    "Path=/",
  ]
    .filter(Boolean)
    .join("; ");

  if (resHeaders) {
    // tRPC context - use resHeaders which will be merged into response
    resHeaders.append("Set-Cookie", cookieValue);
  } else {
    // Server Actions/Route Handlers - use Next.js cookies() API
    const cookieStore = await cookies();
    cookieStore.set(WIZARD_COOKIE_NAME, token, {
      httpOnly: true,
      secure: useSecureCookie,
      sameSite: "lax",
      maxAge: SESSION_TTL_SECONDS,
      path: "/",
    });
  }
}

/**
 * Get wizard navigation state from cookie
 */
async function getWizardCookie(): Promise<WizardNavState | null> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(WIZARD_COOKIE_NAME)?.value;
    if (!token) {
      return null;
    }

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
 * Get wizard navigation state from a raw Cookie header.
 * Used for non-Next handlers (tRPC, Hono) that only have Request headers.
 */
async function getWizardNavStateFromCookieHeader(
  cookieHeader: string
): Promise<WizardNavState | null> {
  try {
    const parsedCookies = parseCookieHeader(cookieHeader);
    const token = parsedCookies[WIZARD_COOKIE_NAME];
    if (!token) {
      return null;
    }

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
 * Clear wizard cookie.
 *
 * IMPORTANT: When called from tRPC handlers, you MUST pass resHeaders from ctx.
 * The Next.js cookies() API doesn't work in tRPC's fetch adapter context.
 */
export async function clearWizardCookie(resHeaders?: Headers): Promise<void> {
  // Only set Secure flag when using HTTPS
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "";
  const isHttps = appUrl.startsWith("https://");
  const useSecureCookie = process.env.NODE_ENV === "production" && isHttps;

  if (resHeaders) {
    // tRPC context - use resHeaders to expire the cookie
    const cookieValue = [
      `${WIZARD_COOKIE_NAME}=`,
      "HttpOnly",
      useSecureCookie ? "Secure" : "",
      "SameSite=Lax",
      "Max-Age=0", // Expire immediately
      "Path=/",
    ]
      .filter(Boolean)
      .join("; ");
    resHeaders.append("Set-Cookie", cookieValue);
  } else {
    // Server Actions/Route Handlers - use Next.js cookies() API
    const cookieStore = await cookies();
    cookieStore.delete(WIZARD_COOKIE_NAME);
  }
}

/**
 * Save wizard state (combines cookie + database storage)
 *
 * @param sessionId - Session ID (generated if not provided)
 * @param state - Wizard state to save (step)
 * @param resHeaders - Response headers for tRPC context (required for cookie setting)
 * @returns The session including its ID
 *
 * IMPORTANT: When called from tRPC handlers, you MUST pass resHeaders from ctx.
 */
export async function saveWizardState(
  sessionId: string | undefined,
  state: { step: number },
  resHeaders?: Headers
): Promise<OnboardingSession> {
  // Save to database (generates sessionId if not provided)
  const session = await upsertOnboardingSession({
    id: sessionId,
    step: state.step,
  });

  // Set navigation cookie with sessionId
  await setWizardCookie(
    { sessionId: session.id, step: state.step },
    resHeaders
  );

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
  const session = await getOnboardingSessionById(navState.sessionId);
  if (!session) {
    // Cookie exists but session expired/missing in DB - clear stale cookie
    await clearWizardCookie();
    return { state: null, wasCleared: true };
  }

  return {
    state: {
      sessionId: session.id,
      step: session.step,
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
 *
 * IMPORTANT: When called from tRPC handlers, you MUST pass resHeaders from ctx.
 */
export async function updateWizardProgress(
  sessionId: string,
  updates: {
    step?: number;
    documentProcessed?: boolean;
    livenessPassed?: boolean;
    faceMatchPassed?: boolean;
    keysSecured?: boolean;
    documentHash?: string;
    identityDraftId?: string | null;
  },
  resHeaders?: Headers
): Promise<void> {
  const previousSession = await getOnboardingSessionById(sessionId);
  const previousStep = previousSession?.step ?? null;
  const inferredStep = updates.step ?? (updates.keysSecured ? 5 : null);
  const step = inferredStep ?? undefined;

  // Update database
  await upsertOnboardingSession({
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
    await setWizardCookie({ sessionId, step }, resHeaders);
  }
}

/**
 * Complete onboarding - delete session data
 *
 * IMPORTANT: When called from tRPC handlers, you MUST pass resHeaders from ctx.
 */
export async function completeOnboarding(
  sessionId: string,
  resHeaders?: Headers
): Promise<void> {
  await deleteOnboardingSessionById(sessionId);
  addSpanEvent("onboarding.complete", {});
  await clearWizardCookie(resHeaders);
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
  "face-match": { minStep: 2, requiredFields: ["documentProcessed"] },
  "secure-keys": { minStep: 4, requiredFields: ["documentProcessed"] },
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
  endpoint: string
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
  if (!navState) {
    return null;
  }

  const session = await getOnboardingSessionById(navState.sessionId);
  if (!session) {
    // Cookie exists but session expired/missing in DB
    await clearWizardCookie();
    return null;
  }

  return session;
}

/**
 * Get onboarding session from a raw Cookie header.
 * Does not mutate cookies; returns null if missing/expired.
 */
export async function getSessionFromCookieHeader(
  cookieHeader: string | null
): Promise<OnboardingSession | null> {
  if (!cookieHeader) {
    return null;
  }

  const navState = await getWizardNavStateFromCookieHeader(cookieHeader);
  if (!navState) {
    return null;
  }

  const session = await getOnboardingSessionById(navState.sessionId);
  if (!session) {
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
 * @param resHeaders - Response headers for tRPC context
 *
 * IMPORTANT: When called from tRPC handlers, you MUST pass resHeaders from ctx.
 */
export async function resetToStep(
  sessionId: string,
  targetStep: OnboardingStep,
  resHeaders?: Headers
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

  await updateWizardProgress(sessionId, updates, resHeaders);
}

/**
 * Mark liveness as skipped (alternative to completing liveness verification)
 *
 * @param sessionId - Session ID
 * @param resHeaders - Response headers for tRPC context
 *
 * IMPORTANT: When called from tRPC handlers, you MUST pass resHeaders from ctx.
 */
// (No skipLiveness helper; liveness completion is recorded via identity.prepareLiveness.)
