/**
 * Assurance Computation Functions
 *
 * Pure functions for computing assurance state from raw data.
 * No side effects, no database access - just input → output transformations.
 */

import type {
  AccountTier,
  AssuranceState,
  AuthStrength,
  LoginMethod,
  TIER_NAMES,
  TierName,
  VerificationDetails,
} from "./types";

/**
 * Required ZK proof types for full verification (Tier 2)
 *
 * Note: identity_binding is NOT required for Tier 2 but IS required for
 * on-chain attestation (prevents replay attacks). It's validated separately
 * during attestation flow.
 */
export const REQUIRED_ZK_PROOF_TYPES = [
  "age_verification",
  "doc_validity",
  "nationality_membership",
  "face_match",
] as const;

/**
 * Required signed claim types for identity verification
 */
export const REQUIRED_SIGNED_CLAIM_TYPES = [
  "ocr_result",
  "liveness_score",
  "face_match_score",
] as const;

/**
 * Valid login methods
 */
const VALID_LOGIN_METHODS = new Set<LoginMethod>([
  "passkey",
  "opaque",
  "magic-link",
  "eip712",
  "anonymous",
  "credential",
]);

/**
 * Type guard for valid login methods
 */
function isValidLoginMethod(method: unknown): method is LoginMethod {
  return (
    typeof method === "string" && VALID_LOGIN_METHODS.has(method as LoginMethod)
  );
}

/**
 * Derive auth strength from login method
 *
 * Passkey = strong (phishing-resistant)
 * Everything else = basic
 */
export function deriveAuthStrength(
  loginMethod: string | null | undefined
): AuthStrength {
  return loginMethod === "passkey" ? "strong" : "basic";
}

/**
 * Input data for computing assurance state
 */
export interface AssuranceInput {
  hasSession: boolean;
  loginMethod: string | null | undefined;
  hasSecuredKeys: boolean;
  documentVerified: boolean;
  livenessVerified: boolean;
  faceMatchVerified: boolean;
  zkProofsComplete: boolean;
  fheComplete: boolean;
  onChainAttested: boolean;
  needsDocumentReprocessing?: boolean;
}

/**
 * Compute user's complete assurance state
 *
 * Tier logic:
 * - Tier 0: No session (not authenticated)
 * - Tier 1: Authenticated + FHE keys secured
 * - Tier 2: Tier 1 + identity verified + all ZK proofs + FHE complete
 */
export function computeAssuranceState(input: AssuranceInput): AssuranceState {
  const {
    hasSession,
    loginMethod,
    hasSecuredKeys,
    documentVerified,
    livenessVerified,
    faceMatchVerified,
    zkProofsComplete,
    fheComplete,
    onChainAttested,
    needsDocumentReprocessing = false,
  } = input;

  const authStrength = deriveAuthStrength(loginMethod);
  const method: LoginMethod | "none" = isValidLoginMethod(loginMethod)
    ? loginMethod
    : "none";

  const identityComplete =
    documentVerified && livenessVerified && faceMatchVerified;
  const proofsComplete = zkProofsComplete && fheComplete;

  // Detect incomplete proofs: identity done but proofs missing
  const hasIncompleteProofs = identityComplete && !proofsComplete;

  // Compute tier
  let tier: AccountTier = 0;

  if (hasSession && hasSecuredKeys) {
    tier = 1; // Account tier

    if (identityComplete && proofsComplete) {
      tier = 2; // Verified tier
    }
  }

  const tierNames: typeof TIER_NAMES = {
    0: "Anonymous",
    1: "Account",
    2: "Verified",
  };

  const details: VerificationDetails = {
    isAuthenticated: hasSession,
    hasSecuredKeys,
    documentVerified,
    livenessVerified,
    faceMatchVerified,
    zkProofsComplete,
    fheComplete,
    hasIncompleteProofs,
    needsDocumentReprocessing,
    onChainAttested,
  };

  return {
    tier,
    tierName: tierNames[tier] as TierName,
    authStrength,
    loginMethod: method,
    details,
  };
}

/**
 * Check if ZK proofs are complete based on proof types
 */
export function areZkProofsComplete(proofTypes: string[]): boolean {
  return REQUIRED_ZK_PROOF_TYPES.every((type) => proofTypes.includes(type));
}

/**
 * Check if signed claims are complete based on claim types
 */
export function areSignedClaimsComplete(claimTypes: string[]): boolean {
  return REQUIRED_SIGNED_CLAIM_TYPES.every((type) => claimTypes.includes(type));
}

/**
 * Check if FHE is complete based on attribute types
 *
 * FHE is complete when required encrypted attributes are present:
 * - DOB (birth_year_offset or dob_days)
 * - liveness_score
 */
export function isFheComplete(attributeTypes: string[]): boolean {
  const hasDob =
    attributeTypes.includes("birth_year_offset") ||
    attributeTypes.includes("dob_days");
  const hasLiveness = attributeTypes.includes("liveness_score");
  return hasDob && hasLiveness;
}
