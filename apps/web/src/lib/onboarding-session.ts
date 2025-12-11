/**
 * Onboarding Session Management
 *
 * Handles secure storage of wizard state using:
 * - jose JWE for encrypting sensitive PII before database storage
 * - SQLite for server-side session persistence
 * - Encrypted cookies for stateless wizard navigation
 *
 * Security model:
 * - PII is encrypted with AES-256-GCM before storage
 * - Only email + step stored in navigation cookie
 * - Sensitive data (documents, selfies) never stored - processed in real-time
 */

import { EncryptJWT, jwtDecrypt } from "jose";
import { cookies } from "next/headers";
import {
  deleteOnboardingSession,
  getOnboardingSessionByEmail,
  upsertOnboardingSession,
  type OnboardingSession,
} from "./db";

// Get encryption secret from environment (same as better-auth)
const getSecret = () => {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) {
    throw new Error("BETTER_AUTH_SECRET environment variable is required");
  }
  return new TextEncoder().encode(secret);
};

const WIZARD_COOKIE_NAME = "zentity-wizard";
const SESSION_TTL_SECONDS = 5 * 60; // 5 minutes

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
 */
export interface WizardNavState {
  email: string;
  step: number;
}

/**
 * Full wizard state (combined from cookie + database)
 */
export interface FullWizardState {
  email: string;
  step: number;
  pii?: EncryptedPiiData;
  documentProcessed: boolean;
  livenessPassed: boolean;
  faceMatchPassed: boolean;
}

/**
 * Encrypt PII data using jose JWE (AES-256-GCM)
 */
export async function encryptPii(pii: EncryptedPiiData): Promise<string> {
  const secret = getSecret();

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
export async function decryptPii(
  token: string,
): Promise<EncryptedPiiData | null> {
  try {
    const secret = getSecret();
    const { payload } = await jwtDecrypt(token, secret);
    return (payload.pii as EncryptedPiiData) || null;
  } catch {
    // Token expired or invalid
    return null;
  }
}

/**
 * Set wizard navigation cookie (email + step only)
 */
export async function setWizardCookie(state: WizardNavState): Promise<void> {
  const secret = getSecret();

  const token = await new EncryptJWT({ email: state.email, step: state.step })
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .encrypt(secret);

  const cookieStore = await cookies();
  cookieStore.set(WIZARD_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_TTL_SECONDS,
    path: "/",
  });
}

/**
 * Get wizard navigation state from cookie
 */
export async function getWizardCookie(): Promise<WizardNavState | null> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(WIZARD_COOKIE_NAME)?.value;
    if (!token) return null;

    const secret = getSecret();
    const { payload } = await jwtDecrypt(token, secret);

    return {
      email: payload.email as string,
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
 * @param state - Wizard state to save
 * @param pii - Optional PII data to encrypt and store
 */
export async function saveWizardState(
  state: WizardNavState,
  pii?: EncryptedPiiData,
): Promise<void> {
  // Set navigation cookie
  await setWizardCookie(state);

  // Encrypt PII if provided
  let encryptedPii: string | null = null;
  if (pii && Object.keys(pii).length > 0) {
    encryptedPii = await encryptPii(pii);
  }

  // Save to database
  upsertOnboardingSession({
    email: state.email,
    step: state.step,
    encryptedPii,
  });
}

/**
 * Load full wizard state (from cookie + database)
 */
export async function loadWizardState(): Promise<FullWizardState | null> {
  // Get navigation state from cookie
  const navState = await getWizardCookie();
  if (!navState) return null;

  // Get full session from database
  const session = getOnboardingSessionByEmail(navState.email);
  if (!session) {
    // Cookie exists but session expired, clear cookie
    await clearWizardCookie();
    return null;
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
    email: session.email,
    step: session.step,
    pii,
    documentProcessed: session.documentProcessed,
    livenessPassed: session.livenessPassed,
    faceMatchPassed: session.faceMatchPassed,
  };
}

/**
 * Update wizard step and verification flags
 */
export async function updateWizardProgress(
  email: string,
  updates: {
    step?: number;
    documentProcessed?: boolean;
    livenessPassed?: boolean;
    faceMatchPassed?: boolean;
    documentHash?: string;
  },
): Promise<void> {
  // Update database
  upsertOnboardingSession({
    email,
    ...updates,
  });

  // Update cookie if step changed
  if (updates.step !== undefined) {
    await setWizardCookie({ email, step: updates.step });
  }
}

/**
 * Complete onboarding - delete session data
 */
export async function completeOnboarding(email: string): Promise<void> {
  deleteOnboardingSession(email);
  await clearWizardCookie();
}

/**
 * Get onboarding session for API use
 */
export function getOnboardingSession(
  email: string,
): OnboardingSession | null {
  return getOnboardingSessionByEmail(email);
}
