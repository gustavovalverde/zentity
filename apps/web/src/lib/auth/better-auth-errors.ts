import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "./password-policy";

/**
 * Better Auth error helpers.
 *
 * Why this exists:
 * - Better Auth returns structured `{ code, message }` errors.
 * - We want consistent, user-friendly copy across sign-up / reset / change
 *   password flows without duplicating switch/if ladders in multiple files.
 */

type BetterAuthErrorLike = {
  code?: string;
  message?: string;
};

function asBetterAuthErrorLike(error: unknown): BetterAuthErrorLike | null {
  if (!error || typeof error !== "object") return null;
  return error as BetterAuthErrorLike;
}

/**
 * Returns the error message from Better Auth when available, otherwise a fallback.
 */
export function getBetterAuthErrorMessage(
  error: unknown,
  fallbackMessage: string,
) {
  const err = asBetterAuthErrorLike(error);
  return err?.message || fallbackMessage;
}

/**
 * Maps Better Auth password policy errors to stable UX copy.
 *
 * This intentionally *does not* try to map every possible auth error.
 */
export function getPasswordPolicyErrorMessage(
  error: unknown,
): string | undefined {
  const err = asBetterAuthErrorLike(error);

  if (err?.code === "PASSWORD_COMPROMISED") {
    return "This password has appeared in data breaches. Please choose a different password.";
  }

  if (err?.message === "Password too short") {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters`;
  }

  if (err?.message === "Password too long") {
    return `Password must be at most ${PASSWORD_MAX_LENGTH} characters`;
  }

  return undefined;
}
