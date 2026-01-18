/**
 * Tier Derivation and Feature Gating
 *
 * Builds tier profiles with human-readable labels, progress tracking,
 * and feature access checks. Uses pure functions from compute.ts.
 */

import type {
  AccountTier,
  AssuranceProfile,
  AuthAAL,
  FeatureGate,
  FeatureName,
  TierLabel,
  TierProfile,
  TierRequirement,
} from "./types";

import { computeAccountTier } from "./compute";

/**
 * Map tier numbers to human-readable labels
 */
const TIER_LABELS: Record<AccountTier, TierLabel> = {
  0: "Explore",
  1: "Account",
  2: "Verified",
  3: "Auditable",
};

/**
 * Feature gates defining tier and AAL requirements
 *
 * Key constraint: on-chain attestation requires BOTH Tier 3 AND AAL2
 */
const FEATURE_GATES: Record<FeatureName, FeatureGate> = {
  dashboard: {
    feature: "dashboard",
    minTier: 1,
    minAAL: 1,
    description: "Access your identity dashboard",
  },
  profile: {
    feature: "profile",
    minTier: 1,
    minAAL: 1,
    description: "Manage your profile settings",
  },
  export_bundle: {
    feature: "export_bundle",
    minTier: 2,
    minAAL: 1,
    description: "Export your identity bundle",
  },
  basic_disclosures: {
    feature: "basic_disclosures",
    minTier: 2,
    minAAL: 1,
    description: "Create selective disclosures",
  },
  attestation: {
    feature: "attestation",
    minTier: 3,
    minAAL: 2, // Requires passkey for on-chain operations
    description: "Attest identity on-chain",
  },
  token_minting: {
    feature: "token_minting",
    minTier: 3,
    minAAL: 2,
    description: "Mint compliance tokens",
  },
  guardian_recovery: {
    feature: "guardian_recovery",
    minTier: 1,
    minAAL: 2, // Guardians require passkey auth for security
    description: "Set up guardian-based recovery",
  },
};

/**
 * Build requirements for advancing from current tier to next tier
 */
function getNextTierRequirements(
  currentTier: AccountTier,
  assurance: AssuranceProfile
): TierRequirement[] | null {
  if (currentTier >= 3) {
    return null; // Already at max tier
  }

  const requirements: TierRequirement[] = [];

  // Tier 0 → 1: Need to authenticate
  if (currentTier === 0) {
    requirements.push({
      id: "authenticate",
      label: "Create Account",
      description: "Sign up or sign in to access your dashboard",
      completed: false,
      action: { label: "Sign Up", href: "/sign-up" },
    });
    return requirements;
  }

  // Tier 1 → 2: Need identity verification
  if (currentTier === 1) {
    requirements.push({
      id: "document",
      label: "Verify Document",
      description: "Upload and verify your identity document",
      completed: assurance.identity.documentVerified,
      action: assurance.identity.documentVerified
        ? undefined
        : { label: "Verify Document", href: "/dashboard/verify" },
    });
    requirements.push({
      id: "liveness",
      label: "Liveness Check",
      description: "Complete a liveness verification",
      completed: assurance.identity.livenessPassed,
      action: assurance.identity.livenessPassed
        ? undefined
        : { label: "Verify Liveness", href: "/dashboard/verify" },
    });
    requirements.push({
      id: "face_match",
      label: "Face Match",
      description: "Match your face to your document photo",
      completed: assurance.identity.faceMatchPassed,
      action: assurance.identity.faceMatchPassed
        ? undefined
        : { label: "Match Face", href: "/dashboard/verify" },
    });
    return requirements;
  }

  // Tier 2 → 3: Need cryptographic proofs
  // Note: Proof generation requires document data which isn't persisted.
  // Users must complete a new verification to generate proofs.
  // No action buttons here - the verify page handles the re-verification CTA.
  if (currentTier === 2) {
    requirements.push({
      id: "zk_proofs",
      label: "ZK Proofs",
      description: "Generate zero-knowledge proofs for all claims",
      completed: assurance.proof.zkProofsComplete,
    });
    requirements.push({
      id: "fhe_encryption",
      label: "FHE Encryption",
      description: "Encrypt sensitive attributes with FHE",
      completed: assurance.proof.fheComplete,
    });
    return requirements;
  }

  return null;
}

/**
 * Build complete tier profile from assurance data
 */
export function buildTierProfile(assurance: AssuranceProfile): TierProfile {
  const tier = computeAccountTier(assurance);

  return {
    tier,
    aal: assurance.auth.level,
    assurance,
    label: TIER_LABELS[tier],
    nextTierRequirements: getNextTierRequirements(tier, assurance),
  };
}

/**
 * Check if a feature is unlocked for given tier and AAL
 */
export function isFeatureUnlocked(
  feature: FeatureName,
  tier: AccountTier,
  aal: AuthAAL
): boolean {
  const gate = FEATURE_GATES[feature];
  return tier >= gate.minTier && aal >= gate.minAAL;
}

/**
 * Get feature gate configuration
 */
export function getFeatureGate(feature: FeatureName): FeatureGate {
  return FEATURE_GATES[feature];
}

/**
 * Get human-readable message for why a feature is locked
 */
export function getFeatureRequirementMessage(
  feature: FeatureName,
  profile: TierProfile
): string {
  const gate = FEATURE_GATES[feature];
  const reasons: string[] = [];

  if (profile.tier < gate.minTier) {
    reasons.push(
      `Requires Tier ${gate.minTier} (${TIER_LABELS[gate.minTier]})`
    );
  }

  if (profile.aal < gate.minAAL) {
    const aalDescription =
      gate.minAAL === 2 ? "passkey authentication" : "authentication";
    reasons.push(`Requires ${aalDescription}`);
  }

  return reasons.length > 0
    ? reasons.join(" and ")
    : `${gate.description} is available`;
}

/**
 * Get all feature gates (for UI listing)
 */
export function getAllFeatureGates(): FeatureGate[] {
  return Object.values(FEATURE_GATES);
}

/**
 * Calculate tier progress percentage
 */
export function getTierProgress(profile: TierProfile): number {
  if (
    !profile.nextTierRequirements ||
    profile.nextTierRequirements.length === 0
  ) {
    return 100;
  }

  const completed = profile.nextTierRequirements.filter(
    (r) => r.completed
  ).length;
  return Math.round((completed / profile.nextTierRequirements.length) * 100);
}
