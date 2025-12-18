/**
 * Authentication Module - Client-Safe Exports
 *
 * This barrel file only exports modules that are safe for client components.
 * For server-only auth utilities (api-auth, rp-flow), import directly from
 * the specific module files.
 */

// Client-side auth hooks and methods
export { authClient, signIn, signOut, signUp } from "./auth-client";
// Error handling utilities (pure functions, client-safe)
export {
  getBetterAuthErrorMessage,
  getPasswordPolicyErrorMessage,
} from "./better-auth-errors";
// Password policy (pure functions, client-safe)
export {
  getPasswordLengthError,
  getPasswordRequirementStatus,
  getPasswordSimilarityError,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from "./password-policy";
// Password breach checking (client-safe)
export { checkPasswordPwned } from "./password-pwned";
