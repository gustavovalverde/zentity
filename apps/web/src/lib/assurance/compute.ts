/**
 * Assurance Computation Functions
 *
 * Pure functions for computing assurance levels from raw data.
 * No side effects, no database access - just input → output transformations.
 * This makes the tier logic easily testable and predictable.
 */

import type {
  AccountTier,
  AssuranceProfile,
  AuthAAL,
  AuthAssurance,
  IdentityAssurance,
  LoginMethod,
  ProofAssurance,
} from "./types";

/**
 * Required ZK proof types for full verification (Tier 3)
 *
 * Note: identity_binding is NOT required for Tier 3 but IS required for
 * on-chain attestation (prevents replay attacks). It's shown in the UI
 * when present but doesn't block progression to Tier 3.
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
 * Required FHE encrypted attribute types for full assurance
 */
export const REQUIRED_FHE_ATTRIBUTE_TYPES = [
  "birth_year_offset",
  "dob_days",
  "country_code",
  "compliance_level",
] as const;

/**
 * Derive Auth Assurance Level from session state
 *
 * Note: isAnonymous (users with @anon.zentity.app emails) is NOT used here.
 * Users with anonymous emails have created accounts and should get AAL >= 1.
 * The isAnonymous flag is for UI display only, not security decisions.
 *
 * @param hasSession - Whether a valid session exists
 * @param loginMethod - The method used to authenticate
 * @param _isAnonymous - Whether the user has anonymous email (unused for AAL)
 * @returns The derived AAL (0-2)
 */
export function deriveAAL(
  hasSession: boolean,
  loginMethod: string | null | undefined,
  _isAnonymous: boolean
): AuthAAL {
  if (!hasSession) {
    return 0;
  }

  // Passkey authentication provides AAL2 (phishing-resistant)
  if (loginMethod === "passkey") {
    return 2;
  }

  // All other methods (password, magic link, SIWE, anonymous) provide AAL1
  return 1;
}

/**
 * Build auth assurance from session state
 */
export function computeAuthAssurance(
  hasSession: boolean,
  loginMethod: string | null | undefined,
  isAnonymous: boolean,
  has2FA: boolean
): AuthAssurance {
  const level = deriveAAL(hasSession, loginMethod, isAnonymous);

  let method: LoginMethod | "none" = "none";
  if (hasSession && isValidLoginMethod(loginMethod)) {
    method = loginMethod;
  }

  return {
    level,
    method,
    isAnonymous,
    has2FA,
  };
}

/**
 * Compute identity assurance level from verification checks
 */
export function computeIdentityAssurance(checks: {
  documentVerified: boolean;
  livenessPassed: boolean;
  faceMatchPassed: boolean;
}): IdentityAssurance {
  const { documentVerified, livenessPassed, faceMatchPassed } = checks;
  const allPassed = documentVerified && livenessPassed && faceMatchPassed;
  const somePassed = documentVerified || livenessPassed || faceMatchPassed;

  let level: 0 | 1 | 2 = 0;
  if (allPassed) {
    level = 2;
  } else if (somePassed) {
    level = 1;
  }

  return {
    level,
    documentVerified,
    livenessPassed,
    faceMatchPassed,
  };
}

/**
 * Compute proof assurance level from cryptographic evidence
 */
export function computeProofAssurance(checks: {
  signedClaimTypes: string[];
  zkProofTypes: string[];
  fheAttributeTypes: string[];
  onChainAttested: boolean;
}): ProofAssurance {
  const { signedClaimTypes, zkProofTypes, fheAttributeTypes, onChainAttested } =
    checks;

  const signedClaims = REQUIRED_SIGNED_CLAIM_TYPES.every((type) =>
    signedClaimTypes.includes(type)
  );

  const zkProofsComplete = REQUIRED_ZK_PROOF_TYPES.every((type) =>
    zkProofTypes.includes(type)
  );

  // FHE is complete if we have at least birth_year_offset or dob_days
  const fheComplete =
    fheAttributeTypes.includes("birth_year_offset") ||
    fheAttributeTypes.includes("dob_days");

  // Determine level
  let level: 0 | 1 | 2 = 0;
  if (zkProofsComplete && fheComplete) {
    level = 2;
  } else if (signedClaims || zkProofTypes.length > 0) {
    level = 1;
  }

  return {
    level,
    signedClaims,
    zkProofsComplete,
    fheComplete,
    onChainAttested,
  };
}

/**
 * Compute account tier from complete assurance profile
 *
 * Tier logic (RFC-0017):
 * - Tier 0: No session (not authenticated)
 * - Tier 1: Authenticated (session exists, even with anonymous email)
 * - Tier 2: Identity verified (document + liveness + face match)
 * - Tier 3: Fully auditable (all ZK proofs + FHE complete)
 *
 * Note: isAnonymous (users with @anon.zentity.app emails) does NOT affect tier.
 * Users with anonymous emails have created accounts and should be Tier 1+.
 */
export function computeAccountTier(assurance: AssuranceProfile): AccountTier {
  // Tier 0: No authenticated session
  if (assurance.auth.level === 0) {
    return 0;
  }

  // Tier 3: All proofs complete
  if (assurance.proof.zkProofsComplete && assurance.proof.fheComplete) {
    return 3;
  }

  // Tier 2: Identity fully verified
  if (
    assurance.identity.documentVerified &&
    assurance.identity.livenessPassed &&
    assurance.identity.faceMatchPassed
  ) {
    return 2;
  }

  // Tier 1: Authenticated but not fully verified
  return 1;
}

/**
 * Type guard for valid login methods
 */
function isValidLoginMethod(method: unknown): method is LoginMethod {
  const validMethods: LoginMethod[] = [
    "passkey",
    "opaque",
    "magic-link",
    "siwe",
    "anonymous",
    "credential",
  ];
  return (
    typeof method === "string" && validMethods.includes(method as LoginMethod)
  );
}
