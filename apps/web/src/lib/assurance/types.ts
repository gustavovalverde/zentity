/**
 * Assurance Types (Simplified)
 *
 * Three-tier system representing user verification states:
 * - Tier 0: Anonymous (no session)
 * - Tier 1: Account (authenticated + FHE keys secured)
 * - Tier 2: Verified (identity proven + ZK proofs + FHE complete)
 *
 * Two auth strength levels:
 * - basic: OPAQUE, magic link, SIWE
 * - strong: Passkey (WebAuthn) - required for on-chain operations
 */

/**
 * Account Tier (0-2)
 *
 * | Tier | Name      | What User Has                                |
 * |------|-----------|----------------------------------------------|
 * | 0    | Anonymous | No session                                   |
 * | 1    | Account   | Authenticated + FHE keys secured             |
 * | 2    | Verified  | Account + Identity proven + ZK proofs        |
 */
export type AccountTier = 0 | 1 | 2;

export const TIER_NAMES = {
  0: "Anonymous",
  1: "Account",
  2: "Verified",
} as const;

export type TierName = (typeof TIER_NAMES)[AccountTier];

/**
 * Auth Strength - Determines high-security feature access
 *
 * | Level  | Methods                    | Enables                         |
 * |--------|----------------------------|---------------------------------|
 * | basic  | OPAQUE, magic link, SIWE   | All features except on-chain    |
 * | strong | Passkey (WebAuthn)         | On-chain attestation, minting   |
 */
export type AuthStrength = "basic" | "strong";

/**
 * Login methods supported by Better Auth
 */
export type LoginMethod =
  | "passkey"
  | "opaque" // OPAQUE password-authenticated key exchange
  | "magic-link"
  | "siwe" // Sign-In With Ethereum
  | "anonymous"
  | "credential"; // Legacy password (disabled in prod)

/**
 * Feature requirements for access control
 */
export interface FeatureRequirement {
  minTier: AccountTier;
  requiresStrongAuth: boolean;
}

/**
 * Verification details - breakdown of what the user has completed
 */
export interface VerificationDetails {
  isAuthenticated: boolean;
  hasSecuredKeys: boolean;
  documentVerified: boolean;
  livenessVerified: boolean;
  faceMatchVerified: boolean;
  zkProofsComplete: boolean;
  fheComplete: boolean;
  hasIncompleteProofs: boolean;
  needsDocumentReprocessing: boolean;
  onChainAttested: boolean;
}

/**
 * User's complete assurance state
 *
 * This is the primary type returned by the assurance module.
 * Use it for feature gating and UI rendering decisions.
 */
export interface AssuranceState {
  tier: AccountTier;
  tierName: TierName;
  authStrength: AuthStrength;
  loginMethod: LoginMethod | "none";
  details: VerificationDetails;
}

/**
 * Feature names that can be gated by tier/auth strength
 */
export type FeatureName =
  | "dashboard"
  | "profile"
  | "verification"
  | "attestation"
  | "token_minting"
  | "guardian_recovery";
