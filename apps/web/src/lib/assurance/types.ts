/**
 * Assurance Types
 *
 * Four-tier system representing user verification states:
 * - Tier 0: Anonymous or missing required secured keys
 * - Tier 1: Account with secured keys
 * - Tier 2: Verified identity
 * - Tier 3: Chip verified identity
 *
 * Authentication is modeled separately from proofing:
 * - AccountAssurance: proofing and tier
 * - AuthenticationState: actual login provenance
 * - AccountCapabilities: enrolled authenticators / account affordances
 */

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
  | "anonymous"
  | "credential";

export type AuthenticationSourceKind =
  | "better_auth"
  | "authorize_challenge_opaque"
  | "authorize_challenge_eip712"
  | "authorize_challenge_redirect"
  | "ciba_approval"
  | "token_exchange";

export interface FeatureRequirement {
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
