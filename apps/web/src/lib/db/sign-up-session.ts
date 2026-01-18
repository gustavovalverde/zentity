/**
 * Sign-Up Session Management
 *
 * Handles wizard state for the account creation flow (RFC-0017):
 * - Step 1: Email entry (optional)
 * - Step 2: Account creation (passkey/password)
 * - Step 3: Keys secured (final state)
 *
 * Uses:
 * - SQLite for server-side session persistence
 * - Encrypted cookies for stateless wizard navigation
 *
 * Identity verification happens from the dashboard after account creation.
 */

import type { SignUpSession } from "./schema/sign-up";

import { EncryptJWT, jwtDecrypt } from "jose";
import { cookies } from "next/headers";

import { addSpanEvent } from "@/lib/observability/telemetry";
import { getBetterAuthSecret } from "@/lib/utils/env";

import {
  deleteSignUpSessionById,
  getSignUpSessionById,
  upsertSignUpSession,
} from "./queries/sign-up";

/**
 * Get encryption secret from environment (same as better-auth)
 *
 * AES-256-GCM requires exactly 256 bits (32 bytes).
 * We derive a fixed-length key from the secret using SHA-256.
 */
const getSecret = async (): Promise<Uint8Array> => {
  const secret = getBetterAuthSecret();
  const encoder = new TextEncoder();
  const data = encoder.encode(secret);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return new Uint8Array(hashBuffer);
};

const WIZARD_COOKIE_NAME = "zentity-wizard";
const SESSION_TTL_SECONDS = 30 * 60; // 30 minutes

/**
 * Wizard navigation state (stored in cookie)
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
  keysSecured: boolean;
}

/**
 * Result of loading wizard state
 */
interface WizardStateResult {
  state: FullWizardState | null;
  wasCleared: boolean;
}

/**
 * Set wizard cookie.
 *
 * IMPORTANT: When called from tRPC handlers, you MUST pass resHeaders from ctx.
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
    resHeaders.append("Set-Cookie", cookieValue);
  } else {
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
 * Clear wizard cookie.
 *
 * IMPORTANT: When called from tRPC handlers, you MUST pass resHeaders from ctx.
 */
async function clearWizardCookie(resHeaders?: Headers): Promise<void> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "";
  const isHttps = appUrl.startsWith("https://");
  const useSecureCookie = process.env.NODE_ENV === "production" && isHttps;

  if (resHeaders) {
    const cookieValue = [
      `${WIZARD_COOKIE_NAME}=`,
      "HttpOnly",
      useSecureCookie ? "Secure" : "",
      "SameSite=Lax",
      "Max-Age=0",
      "Path=/",
    ]
      .filter(Boolean)
      .join("; ");
    resHeaders.append("Set-Cookie", cookieValue);
  } else {
    const cookieStore = await cookies();
    cookieStore.delete(WIZARD_COOKIE_NAME);
  }
}

/**
 * Save wizard state (combines cookie + database storage)
 *
 * IMPORTANT: When called from tRPC handlers, you MUST pass resHeaders from ctx.
 */
export async function saveWizardState(
  sessionId: string | undefined,
  state: { step: number },
  resHeaders?: Headers
): Promise<SignUpSession> {
  const session = await upsertSignUpSession({
    id: sessionId,
    step: state.step,
  });

  await setWizardCookie(
    { sessionId: session.id, step: state.step },
    resHeaders
  );

  return session;
}

/**
 * Load full wizard state (from cookie + database)
 */
export async function loadWizardState(): Promise<WizardStateResult> {
  const navState = await getWizardCookie();
  if (!navState) {
    return { state: null, wasCleared: false };
  }

  const session = await getSignUpSessionById(navState.sessionId);
  if (!session) {
    await clearWizardCookie();
    return { state: null, wasCleared: true };
  }

  return {
    state: {
      sessionId: session.id,
      step: session.step,
      keysSecured: session.keysSecured,
    },
    wasCleared: false,
  };
}

/**
 * Update wizard step and keysSecured flag
 *
 * IMPORTANT: When called from tRPC handlers, you MUST pass resHeaders from ctx.
 */
export async function updateWizardProgress(
  sessionId: string,
  updates: {
    step?: number;
    keysSecured?: boolean;
  },
  resHeaders?: Headers
): Promise<void> {
  const previousSession = await getSignUpSessionById(sessionId);
  const previousStep = previousSession?.step ?? null;
  const inferredStep = updates.step ?? (updates.keysSecured ? 3 : null);
  const step = inferredStep ?? undefined;

  await upsertSignUpSession({
    id: sessionId,
    ...updates,
    step,
  });

  addSpanEvent("sign_up.progress", {
    sign_up_step_previous: previousStep ?? undefined,
    sign_up_step: step ?? previousStep ?? undefined,
    sign_up_keys_secured: updates.keysSecured ?? undefined,
  });

  if (step !== undefined) {
    await setWizardCookie({ sessionId, step }, resHeaders);
  }
}

/**
 * Complete sign-up - delete session data
 *
 * IMPORTANT: When called from tRPC handlers, you MUST pass resHeaders from ctx.
 */
export async function completeSignUp(
  sessionId: string,
  resHeaders?: Headers
): Promise<void> {
  await deleteSignUpSessionById(sessionId);
  addSpanEvent("sign_up.complete", {});
  await clearWizardCookie(resHeaders);
}

/**
 * Valid sign-up step numbers
 */
export type SignUpStep = 1 | 2 | 3;

/**
 * Requirements for accessing a specific API endpoint
 */
interface StepRequirements {
  minStep: SignUpStep;
  requiredFields?: "keysSecured"[];
}

/**
 * Step requirements for each protected API endpoint
 */
const STEP_REQUIREMENTS: Record<string, StepRequirements> = {
  "secure-keys": { minStep: 2 },
  complete: { minStep: 3, requiredFields: ["keysSecured"] },
};

/**
 * Validation result for step access
 */
interface StepValidationResult {
  valid: boolean;
  error?: string;
  session?: SignUpSession;
}

/**
 * Validate that the current session has permission to access an endpoint
 */
export function validateStepAccess(
  session: SignUpSession | null,
  endpoint: string
): StepValidationResult {
  if (!session) {
    return {
      valid: false,
      error: "No active sign-up session. Please start from the beginning.",
    };
  }

  const requirements = STEP_REQUIREMENTS[endpoint];
  if (!requirements) {
    return { valid: true, session };
  }

  if (session.step < requirements.minStep) {
    return {
      valid: false,
      error: `Please complete step ${requirements.minStep - 1} first.`,
    };
  }

  if (requirements.requiredFields) {
    for (const field of requirements.requiredFields) {
      if (!session[field]) {
        const fieldName = field.replaceAll(/([A-Z])/g, " $1").toLowerCase();
        return {
          valid: false,
          error: `Required step not completed: ${fieldName}.`,
        };
      }
    }
  }

  return { valid: true, session };
}

/**
 * Get session from wizard cookie for API route validation
 */
export async function getSessionFromCookie(): Promise<SignUpSession | null> {
  const navState = await getWizardCookie();
  if (!navState) {
    return null;
  }

  const session = await getSignUpSessionById(navState.sessionId);
  if (!session) {
    await clearWizardCookie();
    return null;
  }

  return session;
}

/**
 * Reset session progress to a specific step
 *
 * IMPORTANT: When called from tRPC handlers, you MUST pass resHeaders from ctx.
 */
export async function resetToStep(
  sessionId: string,
  targetStep: SignUpStep,
  resHeaders?: Headers
): Promise<void> {
  const updates: {
    step: number;
    keysSecured?: boolean;
  } = { step: targetStep };

  if (targetStep < 3) {
    updates.keysSecured = false;
  }

  await updateWizardProgress(sessionId, updates, resHeaders);
}
