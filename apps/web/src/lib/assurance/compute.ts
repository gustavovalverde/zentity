/**
 * Assurance Computation Functions
 *
 * Pure functions for computing account assurance and auth strength from raw
 * input. No database access.
 */

import type {
  AccountAssurance,
  AccountTier,
  AuthStrength,
  LoginMethod,
  TIER_NAMES,
  TierName,
  VerificationDetails,
} from "./types";

const VALID_LOGIN_METHODS = new Set<LoginMethod>([
  "passkey",
  "opaque",
  "magic-link",
  "oauth",
  "eip712",
  "anonymous",
  "credential",
]);

export function isValidLoginMethod(method: unknown): method is LoginMethod {
  return (
    typeof method === "string" && VALID_LOGIN_METHODS.has(method as LoginMethod)
  );
}

export function deriveAuthStrength(
  loginMethod: LoginMethod | string | null | undefined
): AuthStrength {
  return loginMethod === "passkey" ? "strong" : "basic";
}

interface AccountAssuranceInput {
  chipVerified: boolean;
  documentVerified: boolean;
  faceMatchVerified: boolean;
  fheComplete: boolean;
  hasSecuredKeys: boolean;
  isAuthenticated: boolean;
  livenessVerified: boolean;
  missingProfileSecret?: boolean;
  needsDocumentReprocessing?: boolean;
  onChainAttested: boolean;
  zkProofsComplete: boolean;
}

export function computeAccountAssurance(
  input: AccountAssuranceInput
): AccountAssurance {
  const {
    isAuthenticated,
    hasSecuredKeys,
    chipVerified,
    documentVerified,
    livenessVerified,
    faceMatchVerified,
    zkProofsComplete,
    fheComplete,
    onChainAttested,
    missingProfileSecret = false,
    needsDocumentReprocessing = false,
  } = input;

  const identityComplete =
    documentVerified && livenessVerified && faceMatchVerified;
  const proofsComplete = zkProofsComplete && fheComplete;
  const hasIncompleteProofs = identityComplete && !zkProofsComplete;

  let tier: AccountTier = 0;
  if (isAuthenticated && hasSecuredKeys) {
    tier = 1;
    if (chipVerified && fheComplete) {
      tier = 3;
    } else if (identityComplete && proofsComplete) {
      tier = 2;
    }
  }

  const tierNames: typeof TIER_NAMES = {
    0: "Anonymous",
    1: "Account",
    2: "Verified",
    3: "Chip Verified",
  };

  const details: VerificationDetails = {
    isAuthenticated,
    hasSecuredKeys,
    chipVerified,
    documentVerified,
    livenessVerified,
    faceMatchVerified,
    zkProofsComplete,
    fheComplete,
    hasIncompleteProofs,
    missingProfileSecret,
    needsDocumentReprocessing,
    onChainAttested,
  };

  return {
    tier,
    tierName: tierNames[tier] as TierName,
    details,
  };
}

export function isFheComplete(attributeTypes: string[]): boolean {
  const hasDob =
    attributeTypes.includes("birth_year_offset") ||
    attributeTypes.includes("dob_days");
  const hasLiveness = attributeTypes.includes("liveness_score");
  return hasDob && hasLiveness;
}
