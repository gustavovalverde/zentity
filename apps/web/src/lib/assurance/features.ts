/**
 * Feature Gating
 *
 * Simple feature access control based on tier and auth strength.
 */

import type {
  AccountTier,
  AssuranceState,
  AuthStrength,
  FeatureName,
  FeatureRequirement,
} from "./types";

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
};

/**
 * Check if a feature is accessible for given tier and auth strength
 */
export function canAccessFeature(
  feature: FeatureName,
  tier: AccountTier,
  authStrength: AuthStrength
): boolean {
  const req = FEATURE_REQUIREMENTS[feature];
  const tierOk = tier >= req.minTier;
  const authOk = !req.requiresStrongAuth || authStrength === "strong";
  return tierOk && authOk;
}

/**
 * Get human-readable message for why a feature is locked
 */
export function getBlockedReason(
  feature: FeatureName,
  tier: AccountTier,
  authStrength: AuthStrength
): string | null {
  const req = FEATURE_REQUIREMENTS[feature];

  if (tier < req.minTier) {
    if (tier === 0) {
      return "Sign in to access this feature";
    }
    return "Complete identity verification to access this feature";
  }

  if (req.requiresStrongAuth && authStrength !== "strong") {
    return "Passkey authentication required for this feature";
  }

  return null; // Feature is accessible
}

/**
 * Requirements for advancing to the next tier
 */
interface TierAdvancementRequirement {
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
 * Get requirements for advancing from current tier to next tier
 */
function getNextTierRequirements(
  state: AssuranceState
): TierAdvancementRequirement[] | null {
  const { tier, details } = state;

  // Tier 2 is max
  if (tier >= 2) {
    return null;
  }

  // Tier 0 → 1: Need to authenticate and secure keys
  if (tier === 0) {
    return [
      {
        id: "authenticate",
        label: "Create Account",
        description: "Sign up or sign in to access your dashboard",
        completed: details.isAuthenticated,
        action: { label: "Sign Up", href: "/sign-up" },
      },
    ];
  }

  // Tier 1 → 2: User-facing verification steps only
  // (ZK proofs and FHE encryption are generated automatically during these flows)
  return [
    {
      id: "document",
      label: "Verify Document",
      description: "Upload and verify your identity document",
      completed: details.documentVerified,
      action: details.documentVerified
        ? undefined
        : { label: "Verify Document", href: "/dashboard/verify/document" },
    },
    {
      id: "liveness",
      label: "Liveness Check",
      description: "Complete a liveness verification",
      completed: details.livenessVerified,
      action: details.livenessVerified
        ? undefined
        : { label: "Verify Liveness", href: "/dashboard/verify/liveness" },
    },
    {
      id: "face_match",
      label: "Face Match",
      description: "Match your face to your document photo",
      completed: details.faceMatchVerified,
      action: details.faceMatchVerified
        ? undefined
        : { label: "Match Face", href: "/dashboard/verify/liveness" },
    },
  ];
}

/**
 * Calculate tier progress percentage
 */
export function getTierProgress(state: AssuranceState): number {
  const requirements = getNextTierRequirements(state);

  if (!requirements || requirements.length === 0) {
    return 100;
  }

  const completed = requirements.filter((r) => r.completed).length;
  return Math.round((completed / requirements.length) * 100);
}
