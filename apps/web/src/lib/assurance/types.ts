/**
 * Assurance Types
 *
 * Four-tier system representing user verification states:
 * - Tier 0: Anonymous (no session)
 * - Tier 1: Account (authenticated + FHE keys secured)
 * - Tier 2: Verified (identity proven via OCR + ZK proofs + FHE complete)
 * - Tier 3: Chip Verified (passport NFC chip proof + FHE complete)
 *
 * Two auth strength levels:
 * - basic: OPAQUE, magic link, EIP-712 wallet
 * - strong: Passkey (WebAuthn) - required for on-chain operations
 */

/**
 * Account Tier (0-3)
 *
 * | Tier | Name          | What User Has                                |
 * |------|---------------|----------------------------------------------|
 * | 0    | Anonymous     | No session                                   |
 * | 1    | Account       | Authenticated + FHE keys secured             |
 * | 2    | Verified      | Account + Identity proven + ZK proofs        |
 * | 3    | Chip Verified | Account + Passport NFC chip proof + FHE      |
 */
export type AccountTier = 0 | 1 | 2 | 3;

export const TIER_NAMES = {
  0: "Anonymous",
  1: "Account",
  2: "Verified",
  3: "Chip Verified",
} as const;

export type TierName = (typeof TIER_NAMES)[AccountTier];

/**
 * Auth Strength - Determines high-security feature access
 *
 * | Level  | Methods                    | Enables                         |
 * |--------|----------------------------|---------------------------------|
 * | basic  | OPAQUE, magic link, EIP-712| All features except on-chain    |
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
  | "eip712" // EIP-712 wallet authentication
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

/**
 * User's complete assurance state
 *
 * This is the primary type returned by the assurance module.
 * Use it for feature gating and UI rendering decisions.
 */
export interface AssuranceState {
  authStrength: AuthStrength;
  details: VerificationDetails;
  loginMethod: LoginMethod | "none";
  tier: AccountTier;
  tierName: TierName;
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
  | "guardian_recovery"
  | "enhanced_credentials";
