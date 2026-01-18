/**
 * Tier Module Unit Tests
 *
 * Tests for tier derivation, feature gating, and progress calculation.
 */

import type { AssuranceProfile, TierProfile } from "../types";

import { describe, expect, it } from "vitest";

import {
  buildTierProfile,
  getAllFeatureGates,
  getFeatureGate,
  getFeatureRequirementMessage,
  getTierProgress,
  isFeatureUnlocked,
} from "../tier";

type ProfileOverrides = Partial<{
  authLevel: 0 | 1 | 2;
  isAnonymous: boolean;
  has2FA: boolean;
  documentVerified: boolean;
  livenessPassed: boolean;
  faceMatchPassed: boolean;
  signedClaims: boolean;
  zkProofsComplete: boolean;
  fheComplete: boolean;
  onChainAttested: boolean;
}>;

function deriveAuthMethod(authLevel: number): "passkey" | "opaque" | "none" {
  if (authLevel === 2) {
    return "passkey";
  }
  if (authLevel === 1) {
    return "opaque";
  }
  return "none";
}

function deriveIdentityLevel(overrides: ProfileOverrides): 0 | 1 | 2 {
  const allPassed =
    overrides.documentVerified &&
    overrides.livenessPassed &&
    overrides.faceMatchPassed;
  if (allPassed) {
    return 2;
  }

  const anyPassed =
    overrides.documentVerified ||
    overrides.livenessPassed ||
    overrides.faceMatchPassed;
  if (anyPassed) {
    return 1;
  }

  return 0;
}

function deriveProofLevel(overrides: ProfileOverrides): 0 | 1 | 2 {
  if (overrides.zkProofsComplete && overrides.fheComplete) {
    return 2;
  }
  if (overrides.signedClaims) {
    return 1;
  }
  return 0;
}

function createAssuranceProfile(
  overrides: ProfileOverrides = {}
): AssuranceProfile {
  return {
    auth: {
      level: overrides.authLevel ?? 0,
      method: deriveAuthMethod(overrides.authLevel ?? 0),
      isAnonymous: overrides.isAnonymous ?? false,
      has2FA: overrides.has2FA ?? false,
    },
    identity: {
      level: deriveIdentityLevel(overrides),
      documentVerified: overrides.documentVerified ?? false,
      livenessPassed: overrides.livenessPassed ?? false,
      faceMatchPassed: overrides.faceMatchPassed ?? false,
    },
    proof: {
      level: deriveProofLevel(overrides),
      signedClaims: overrides.signedClaims ?? false,
      zkProofsComplete: overrides.zkProofsComplete ?? false,
      fheComplete: overrides.fheComplete ?? false,
      onChainAttested: overrides.onChainAttested ?? false,
    },
  };
}

describe("buildTierProfile", () => {
  it("builds Tier 0 profile for unauthenticated users", () => {
    const assurance = createAssuranceProfile({ authLevel: 0 });
    const profile = buildTierProfile(assurance);

    expect(profile.tier).toBe(0);
    expect(profile.aal).toBe(0);
    expect(profile.label).toBe("Explore");
  });

  it("builds Tier 1 profile for authenticated users", () => {
    const assurance = createAssuranceProfile({ authLevel: 1 });
    const profile = buildTierProfile(assurance);

    expect(profile.tier).toBe(1);
    expect(profile.aal).toBe(1);
    expect(profile.label).toBe("Account");
  });

  it("builds Tier 2 profile for verified users", () => {
    const assurance = createAssuranceProfile({
      authLevel: 1,
      documentVerified: true,
      livenessPassed: true,
      faceMatchPassed: true,
    });
    const profile = buildTierProfile(assurance);

    expect(profile.tier).toBe(2);
    expect(profile.label).toBe("Verified");
  });

  it("builds Tier 3 profile for fully auditable users", () => {
    const assurance = createAssuranceProfile({
      authLevel: 2,
      documentVerified: true,
      livenessPassed: true,
      faceMatchPassed: true,
      zkProofsComplete: true,
      fheComplete: true,
    });
    const profile = buildTierProfile(assurance);

    expect(profile.tier).toBe(3);
    expect(profile.aal).toBe(2);
    expect(profile.label).toBe("Auditable");
  });

  it("includes nextTierRequirements for non-max tier", () => {
    const assurance = createAssuranceProfile({ authLevel: 1 });
    const profile = buildTierProfile(assurance);

    expect(profile.nextTierRequirements).not.toBeNull();
    expect(profile.nextTierRequirements?.length).toBeGreaterThan(0);
  });

  it("has null nextTierRequirements for max tier", () => {
    const assurance = createAssuranceProfile({
      authLevel: 2,
      documentVerified: true,
      livenessPassed: true,
      faceMatchPassed: true,
      zkProofsComplete: true,
      fheComplete: true,
    });
    const profile = buildTierProfile(assurance);

    expect(profile.nextTierRequirements).toBeNull();
  });

  it("includes correct requirements for Tier 1 → 2 progression", () => {
    const assurance = createAssuranceProfile({
      authLevel: 1,
      documentVerified: false,
      livenessPassed: false,
      faceMatchPassed: false,
    });
    const profile = buildTierProfile(assurance);

    expect(profile.nextTierRequirements).toContainEqual(
      expect.objectContaining({
        id: "document",
        completed: false,
      })
    );
    expect(profile.nextTierRequirements).toContainEqual(
      expect.objectContaining({
        id: "liveness",
        completed: false,
      })
    );
    expect(profile.nextTierRequirements).toContainEqual(
      expect.objectContaining({
        id: "face_match",
        completed: false,
      })
    );
  });

  it("marks completed requirements correctly", () => {
    const assurance = createAssuranceProfile({
      authLevel: 1,
      documentVerified: true,
      livenessPassed: true,
      faceMatchPassed: false,
    });
    const profile = buildTierProfile(assurance);

    const docReq = profile.nextTierRequirements?.find(
      (r) => r.id === "document"
    );
    const livenessReq = profile.nextTierRequirements?.find(
      (r) => r.id === "liveness"
    );
    const faceReq = profile.nextTierRequirements?.find(
      (r) => r.id === "face_match"
    );

    expect(docReq?.completed).toBe(true);
    expect(livenessReq?.completed).toBe(true);
    expect(faceReq?.completed).toBe(false);
  });
});

describe("isFeatureUnlocked", () => {
  it("unlocks dashboard for Tier 1 + AAL1", () => {
    expect(isFeatureUnlocked("dashboard", 1, 1)).toBe(true);
  });

  it("locks dashboard for Tier 0", () => {
    expect(isFeatureUnlocked("dashboard", 0, 0)).toBe(false);
  });

  it("unlocks export_bundle for Tier 2 + AAL1", () => {
    expect(isFeatureUnlocked("export_bundle", 2, 1)).toBe(true);
  });

  it("locks export_bundle for Tier 1", () => {
    expect(isFeatureUnlocked("export_bundle", 1, 1)).toBe(false);
  });

  it("unlocks attestation only for Tier 3 + AAL2", () => {
    expect(isFeatureUnlocked("attestation", 3, 2)).toBe(true);
    expect(isFeatureUnlocked("attestation", 3, 1)).toBe(false);
    expect(isFeatureUnlocked("attestation", 2, 2)).toBe(false);
  });

  it("unlocks token_minting only for Tier 3 + AAL2", () => {
    expect(isFeatureUnlocked("token_minting", 3, 2)).toBe(true);
    expect(isFeatureUnlocked("token_minting", 3, 1)).toBe(false);
    expect(isFeatureUnlocked("token_minting", 2, 2)).toBe(false);
  });

  it("unlocks guardian_recovery for Tier 1 + AAL2", () => {
    expect(isFeatureUnlocked("guardian_recovery", 1, 2)).toBe(true);
    expect(isFeatureUnlocked("guardian_recovery", 1, 1)).toBe(false);
  });
});

describe("getFeatureGate", () => {
  it("returns correct gate configuration", () => {
    const attestationGate = getFeatureGate("attestation");

    expect(attestationGate.feature).toBe("attestation");
    expect(attestationGate.minTier).toBe(3);
    expect(attestationGate.minAAL).toBe(2);
  });

  it("returns all expected features", () => {
    const features = [
      "dashboard",
      "profile",
      "export_bundle",
      "basic_disclosures",
      "attestation",
      "token_minting",
      "guardian_recovery",
    ];

    for (const feature of features) {
      const gate = getFeatureGate(
        feature as Parameters<typeof getFeatureGate>[0]
      );
      expect(gate.feature).toBe(feature);
    }
  });
});

describe("getFeatureRequirementMessage", () => {
  it("returns tier requirement message", () => {
    const profile: TierProfile = {
      tier: 1,
      aal: 1,
      label: "Account",
      assurance: createAssuranceProfile({ authLevel: 1 }),
      nextTierRequirements: null,
    };

    const message = getFeatureRequirementMessage("attestation", profile);

    expect(message).toContain("Tier 3");
    expect(message).toContain("Auditable");
  });

  it("returns AAL requirement message for passkey-required features", () => {
    const profile: TierProfile = {
      tier: 3,
      aal: 1,
      label: "Auditable",
      assurance: createAssuranceProfile({
        authLevel: 1,
        documentVerified: true,
        livenessPassed: true,
        faceMatchPassed: true,
        zkProofsComplete: true,
        fheComplete: true,
      }),
      nextTierRequirements: null,
    };

    const message = getFeatureRequirementMessage("attestation", profile);

    expect(message).toContain("passkey");
  });

  it("returns combined message for both tier and AAL requirements", () => {
    const profile: TierProfile = {
      tier: 1,
      aal: 1,
      label: "Account",
      assurance: createAssuranceProfile({ authLevel: 1 }),
      nextTierRequirements: null,
    };

    const message = getFeatureRequirementMessage("attestation", profile);

    expect(message).toContain("Tier 3");
    expect(message).toContain("passkey");
    expect(message).toContain("and");
  });
});

describe("getAllFeatureGates", () => {
  it("returns all feature gates", () => {
    const gates = getAllFeatureGates();

    expect(gates.length).toBeGreaterThan(0);
    expect(
      gates.every((g) => g.feature && g.minTier >= 0 && g.minAAL >= 0)
    ).toBe(true);
  });
});

describe("getTierProgress", () => {
  it("returns 100 for max tier", () => {
    const profile: TierProfile = {
      tier: 3,
      aal: 2,
      label: "Auditable",
      assurance: createAssuranceProfile({
        authLevel: 2,
        documentVerified: true,
        livenessPassed: true,
        faceMatchPassed: true,
        zkProofsComplete: true,
        fheComplete: true,
      }),
      nextTierRequirements: null,
    };

    expect(getTierProgress(profile)).toBe(100);
  });

  it("returns 0 for no completed requirements", () => {
    const profile: TierProfile = {
      tier: 1,
      aal: 1,
      label: "Account",
      assurance: createAssuranceProfile({ authLevel: 1 }),
      nextTierRequirements: [
        { id: "doc", label: "Doc", description: "...", completed: false },
        {
          id: "liveness",
          label: "Liveness",
          description: "...",
          completed: false,
        },
        { id: "face", label: "Face", description: "...", completed: false },
      ],
    };

    expect(getTierProgress(profile)).toBe(0);
  });

  it("returns correct percentage for partial completion", () => {
    const profile: TierProfile = {
      tier: 1,
      aal: 1,
      label: "Account",
      assurance: createAssuranceProfile({ authLevel: 1 }),
      nextTierRequirements: [
        { id: "doc", label: "Doc", description: "...", completed: true },
        {
          id: "liveness",
          label: "Liveness",
          description: "...",
          completed: false,
        },
        { id: "face", label: "Face", description: "...", completed: false },
      ],
    };

    expect(getTierProgress(profile)).toBe(33);
  });

  it("returns correct percentage for 2/3 completion", () => {
    const profile: TierProfile = {
      tier: 1,
      aal: 1,
      label: "Account",
      assurance: createAssuranceProfile({ authLevel: 1 }),
      nextTierRequirements: [
        { id: "doc", label: "Doc", description: "...", completed: true },
        {
          id: "liveness",
          label: "Liveness",
          description: "...",
          completed: true,
        },
        { id: "face", label: "Face", description: "...", completed: false },
      ],
    };

    expect(getTierProgress(profile)).toBe(67);
  });
});
