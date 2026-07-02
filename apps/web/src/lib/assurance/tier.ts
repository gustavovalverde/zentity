/**
 * Assurance tier model.
 *
 * One pure, client-safe module for the four-tier system, its computation from
 * verification evidence, and feature gating. No database access.
 *
 * Tiers:
 * - Tier 0: Anonymous or missing required secured keys
 * - Tier 1: Account with secured keys
 * - Tier 2: Verified identity
 * - Tier 3: Chip-verified identity
 *
 * Authentication provenance is modeled separately from proofing:
 * - AccountAssurance: proofing and tier
 * - AuthenticationState: login provenance
 * - AccountCapabilities: enrolled authenticators
 */

// ─── Tier and authentication types ─────────────────────────────────

export type AccountTier = 0 | 1 | 2 | 3;

export const TIER_NAMES = {
  0: "Anonymous",
  1: "Account",
  2: "Verified",
  3: "Chip Verified",
} as const;

export type TierName = (typeof TIER_NAMES)[AccountTier];

export type AuthStrength = "basic" | "strong";

export type LoginMethod =
  | "passkey"
  | "opaque"
  | "magic-link"
  | "oauth"
  | "eip712"
  | "credential";

export type AuthenticationSourceKind =
  | "better_auth"
  | "authorize_challenge_opaque"
  | "authorize_challenge_eip712"
  | "authorize_challenge_redirect"
  | "ciba_approval"
  | "token_exchange";

interface FeatureRequirement {
  minTier: AccountTier;
  requiresStrongAuth: boolean;
}

export interface VerificationDetails {
  chipVerified: boolean;
  documentVerified: boolean;
  faceMatchVerified: boolean;
  fheComplete: boolean;
  hasIncompleteProofs: boolean;
  hasSecuredKeys: boolean;
  isAuthenticated: boolean;
  livenessVerified: boolean;
  missingProfileSecret: boolean;
  needsDocumentReprocessing: boolean;
  onChainAttested: boolean;
  zkProofsComplete: boolean;
}

export interface AccountAssurance {
  details: VerificationDetails;
  tier: AccountTier;
  tierName: TierName;
}

export interface AuthenticationState {
  amr: string[];
  authenticatedAt: number;
  authStrength: AuthStrength;
  id: string;
  loginMethod: LoginMethod;
  sourceKind: AuthenticationSourceKind;
}

export interface AccountCapabilities {
  hasOpaqueAccount: boolean;
  hasPasskeys: boolean;
  hasWalletAuth: boolean;
}

export interface SecurityPosture {
  assurance: AccountAssurance;
  auth: AuthenticationState | null;
  capabilities: AccountCapabilities;
}

export type FeatureName =
  | "dashboard"
  | "profile"
  | "verification"
  | "attestation"
  | "token_minting"
  | "guardian_recovery"
  | "enhanced_credentials";

// ─── Login method and auth strength ────────────────────────────────

const VALID_LOGIN_METHODS = new Set<LoginMethod>([
  "passkey",
  "opaque",
  "magic-link",
  "oauth",
  "eip712",
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

// ─── Tier computation ──────────────────────────────────────────────

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
    tierName: TIER_NAMES[tier],
    details,
  };
}

// ─── Feature gating ────────────────────────────────────────────────

/**
 * On-chain operations (attestation, minting) require both Tier 2 and strong
 * auth; guardian recovery requires strong auth (passkey).
 */
const FEATURE_REQUIREMENTS: Record<FeatureName, FeatureRequirement> = {
  dashboard: { minTier: 1, requiresStrongAuth: false },
  profile: { minTier: 1, requiresStrongAuth: false },
  verification: { minTier: 1, requiresStrongAuth: false },
  attestation: { minTier: 2, requiresStrongAuth: true },
  token_minting: { minTier: 2, requiresStrongAuth: true },
  guardian_recovery: { minTier: 1, requiresStrongAuth: true },
  enhanced_credentials: { minTier: 3, requiresStrongAuth: false },
};

function resolveAuthStrength(
  auth: AuthenticationState | AuthStrength | null
): AuthStrength | null {
  if (auth === null) {
    return null;
  }
  return typeof auth === "string" ? auth : auth.authStrength;
}

export function canAccessFeature(
  feature: FeatureName,
  tier: AccountTier,
  auth: AuthenticationState | AuthStrength | null
): boolean {
  const req = FEATURE_REQUIREMENTS[feature];
  const tierOk = tier >= req.minTier;
  const authOk =
    !req.requiresStrongAuth || resolveAuthStrength(auth) === "strong";
  return tierOk && authOk;
}

export function getBlockedReason(
  feature: FeatureName,
  tier: AccountTier,
  auth: AuthenticationState | AuthStrength | null
): string | null {
  const req = FEATURE_REQUIREMENTS[feature];

  if (tier < req.minTier) {
    if (tier === 0) {
      return "Sign in to access this feature";
    }
    return "Complete identity verification to access this feature";
  }

  if (req.requiresStrongAuth && resolveAuthStrength(auth) !== "strong") {
    return "Passkey authentication required for this feature";
  }

  return null;
}
