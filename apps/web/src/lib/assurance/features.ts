/**
 * Feature Gating
 *
 * Simple feature access control based on tier and auth strength.
 */

import type {
  AccountTier,
  AuthenticationState,
  AuthStrength,
  FeatureName,
  FeatureRequirement,
} from "./types";

function resolveAuthStrength(
  auth: AuthenticationState | AuthStrength | null
): AuthStrength | null {
  if (auth === null) {
    return null;
  }
  return typeof auth === "string" ? auth : auth.authStrength;
}

/**
 * Feature gates defining tier and auth strength requirements
 *
 * Key constraints:
 * - On-chain operations (attestation, minting) require BOTH Tier 2 AND strong auth
 * - Guardian recovery requires strong auth (passkey) for security
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

/**
 * Check if a feature is accessible for given tier and auth strength
 */
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

/**
 * Get human-readable message for why a feature is locked
 */
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

  return null; // Feature is accessible
}
