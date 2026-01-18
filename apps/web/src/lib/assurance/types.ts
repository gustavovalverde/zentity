/**
 * Assurance Types
 *
 * Defines the type system for progressive assurance tiers and auth assurance levels.
 * Tiers are computed dynamically from existing database state - no schema changes needed.
 *
 * @see RFC-0017 Progressive Onboarding and Assurance Levels
 */

/**
 * Account tier levels (0-3)
 *
 * | Tier | Name     | Requirements                                    |
 * |------|----------|------------------------------------------------|
 * | 0    | Explore  | No account (unauthenticated)                   |
 * | 1    | Account  | Authenticated + FHE keys secured               |
 * | 2    | Verified | Tier 1 + doc + liveness + face match           |
 * | 3    | Auditable| Tier 2 + all ZK proofs + FHE complete          |
 */
export type AccountTier = 0 | 1 | 2 | 3;

/**
 * Auth Assurance Level (AAL)
 *
 * | Level | Method                    | Features                    |
 * |-------|---------------------------|-----------------------------|
 * | 0     | No session                | None                        |
 * | 1     | Password/Magic link       | Tier 1-3 features           |
 * | 2     | Passkey (WebAuthn)        | Tier 1-3 + on-chain attest  |
 */
export type AuthAAL = 0 | 1 | 2;

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
 * Auth assurance profile - derived from session state
 */
export interface AuthAssurance {
  level: AuthAAL;
  method: LoginMethod | "none";
  isAnonymous: boolean;
  has2FA: boolean;
}

/**
 * Identity verification assurance - derived from documents and signed claims
 */
export interface IdentityAssurance {
  level: 0 | 1 | 2;
  documentVerified: boolean;
  livenessPassed: boolean;
  faceMatchPassed: boolean;
}

/**
 * Cryptographic proof assurance - derived from ZK proofs and FHE state
 */
export interface ProofAssurance {
  level: 0 | 1 | 2;
  signedClaims: boolean;
  zkProofsComplete: boolean;
  fheComplete: boolean;
  onChainAttested: boolean;
}

/**
 * Complete assurance profile combining auth, identity, and proof dimensions
 */
export interface AssuranceProfile {
  auth: AuthAssurance;
  identity: IdentityAssurance;
  proof: ProofAssurance;
}

/**
 * Human-readable tier labels
 */
export type TierLabel = "Explore" | "Account" | "Verified" | "Auditable";

/**
 * Requirement for advancing to a higher tier
 */
export interface TierRequirement {
  id: string;
  label: string;
  description: string;
  completed: boolean;
  action?: {
    label: string;
    href: string;
  };
}

/**
 * Complete tier profile with computed tier, AAL, and next steps
 */
export interface TierProfile {
  tier: AccountTier;
  aal: AuthAAL;
  assurance: AssuranceProfile;
  label: TierLabel;
  nextTierRequirements: TierRequirement[] | null;
}

/**
 * Feature names that can be gated by tier/AAL
 */
export type FeatureName =
  | "dashboard"
  | "profile"
  | "export_bundle"
  | "basic_disclosures"
  | "attestation"
  | "token_minting"
  | "guardian_recovery";

/**
 * Feature gating configuration
 */
export interface FeatureGate {
  feature: FeatureName;
  minTier: AccountTier;
  minAAL: AuthAAL;
  description: string;
}
