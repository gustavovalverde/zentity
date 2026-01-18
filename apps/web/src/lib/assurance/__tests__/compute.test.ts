/**
 * Compute Module Unit Tests
 *
 * Tests for pure assurance computation functions.
 * All functions here are deterministic and have no side effects.
 */

import type { AssuranceProfile } from "../types";

import { describe, expect, it } from "vitest";

import {
  computeAccountTier,
  computeAuthAssurance,
  computeIdentityAssurance,
  computeProofAssurance,
  deriveAAL,
  REQUIRED_FHE_ATTRIBUTE_TYPES,
  REQUIRED_SIGNED_CLAIM_TYPES,
  REQUIRED_ZK_PROOF_TYPES,
} from "../compute";

describe("deriveAAL", () => {
  it("returns 0 when not logged in", () => {
    expect(deriveAAL(false, null, false)).toBe(0);
    expect(deriveAAL(false, "password", false)).toBe(0);
  });

  it("treats anonymous users with sessions as authenticated (RFC-0017)", () => {
    // Anonymous users (with @anon.zentity.app emails) who have accounts
    // should be treated as authenticated, not as Tier 0.
    expect(deriveAAL(true, "password", true)).toBe(1);
    expect(deriveAAL(true, "passkey", true)).toBe(2);
  });

  it("returns 2 for passkey authentication", () => {
    expect(deriveAAL(true, "passkey", false)).toBe(2);
  });

  it("returns 1 for other authenticated methods", () => {
    expect(deriveAAL(true, "opaque", false)).toBe(1);
    expect(deriveAAL(true, "magic-link", false)).toBe(1);
    expect(deriveAAL(true, "siwe", false)).toBe(1);
    expect(deriveAAL(true, null, false)).toBe(1);
    expect(deriveAAL(true, undefined, false)).toBe(1);
  });
});

describe("computeAuthAssurance", () => {
  it("returns correct structure for unauthenticated user", () => {
    const result = computeAuthAssurance(false, null, false, false);

    expect(result).toEqual({
      level: 0,
      method: "none",
      isAnonymous: false,
      has2FA: false,
    });
  });

  it("returns correct structure for opaque (password) auth", () => {
    const result = computeAuthAssurance(true, "opaque", false, false);

    expect(result).toEqual({
      level: 1,
      method: "opaque",
      isAnonymous: false,
      has2FA: false,
    });
  });

  it("returns correct structure for passkey auth", () => {
    const result = computeAuthAssurance(true, "passkey", false, true);

    expect(result).toEqual({
      level: 2,
      method: "passkey",
      isAnonymous: false,
      has2FA: true,
    });
  });

  it("handles unknown login method", () => {
    const result = computeAuthAssurance(true, "unknown_method", false, false);

    expect(result.level).toBe(1);
    expect(result.method).toBe("none");
  });
});

describe("computeIdentityAssurance", () => {
  it("returns level 0 when no verification", () => {
    const result = computeIdentityAssurance({
      documentVerified: false,
      livenessPassed: false,
      faceMatchPassed: false,
    });

    expect(result.level).toBe(0);
    expect(result.documentVerified).toBe(false);
    expect(result.livenessPassed).toBe(false);
    expect(result.faceMatchPassed).toBe(false);
  });

  it("returns level 1 for partial verification", () => {
    const result = computeIdentityAssurance({
      documentVerified: true,
      livenessPassed: true,
      faceMatchPassed: false,
    });

    expect(result.level).toBe(1);
  });

  it("returns level 2 for full verification", () => {
    const result = computeIdentityAssurance({
      documentVerified: true,
      livenessPassed: true,
      faceMatchPassed: true,
    });

    expect(result.level).toBe(2);
    expect(result.documentVerified).toBe(true);
    expect(result.livenessPassed).toBe(true);
    expect(result.faceMatchPassed).toBe(true);
  });
});

describe("computeProofAssurance", () => {
  it("returns level 0 when no proofs", () => {
    const result = computeProofAssurance({
      signedClaimTypes: [],
      zkProofTypes: [],
      fheAttributeTypes: [],
      onChainAttested: false,
    });

    expect(result.level).toBe(0);
    expect(result.signedClaims).toBe(false);
    expect(result.zkProofsComplete).toBe(false);
    expect(result.fheComplete).toBe(false);
    expect(result.onChainAttested).toBe(false);
  });

  it("returns level 1 for partial proofs", () => {
    const result = computeProofAssurance({
      signedClaimTypes: [...REQUIRED_SIGNED_CLAIM_TYPES],
      zkProofTypes: [],
      fheAttributeTypes: [],
      onChainAttested: false,
    });

    expect(result.level).toBe(1);
    expect(result.signedClaims).toBe(true);
  });

  it("returns level 2 for full proofs", () => {
    const result = computeProofAssurance({
      signedClaimTypes: [...REQUIRED_SIGNED_CLAIM_TYPES],
      zkProofTypes: [...REQUIRED_ZK_PROOF_TYPES],
      fheAttributeTypes: [...REQUIRED_FHE_ATTRIBUTE_TYPES],
      onChainAttested: false,
    });

    expect(result.level).toBe(2);
    expect(result.signedClaims).toBe(true);
    expect(result.zkProofsComplete).toBe(true);
    expect(result.fheComplete).toBe(true);
  });

  it("tracks on-chain attestation separately", () => {
    const result = computeProofAssurance({
      signedClaimTypes: [],
      zkProofTypes: [],
      fheAttributeTypes: [],
      onChainAttested: true,
    });

    expect(result.onChainAttested).toBe(true);
    expect(result.level).toBe(0);
  });
});

describe("computeAccountTier", () => {
  const createProfile = (
    overrides: Partial<{
      authLevel: 0 | 1 | 2;
      isAnonymous: boolean;
      documentVerified: boolean;
      livenessPassed: boolean;
      faceMatchPassed: boolean;
      zkProofsComplete: boolean;
      fheComplete: boolean;
    }> = {}
  ): AssuranceProfile => ({
    auth: {
      level: overrides.authLevel ?? 0,
      method: "none",
      isAnonymous: overrides.isAnonymous ?? false,
      has2FA: false,
    },
    identity: {
      level: 0,
      documentVerified: overrides.documentVerified ?? false,
      livenessPassed: overrides.livenessPassed ?? false,
      faceMatchPassed: overrides.faceMatchPassed ?? false,
    },
    proof: {
      level: 0,
      signedClaims: false,
      zkProofsComplete: overrides.zkProofsComplete ?? false,
      fheComplete: overrides.fheComplete ?? false,
      onChainAttested: false,
    },
  });

  it("returns Tier 0 for unauthenticated users", () => {
    const profile = createProfile({ authLevel: 0 });
    expect(computeAccountTier(profile)).toBe(0);
  });

  it("returns Tier 1 for anonymous users with accounts (RFC-0017)", () => {
    // Anonymous users (with @anon.zentity.app emails) who have accounts
    // should be Tier 1, not Tier 0. isAnonymous is for UI display only.
    const profile = createProfile({ authLevel: 1, isAnonymous: true });
    expect(computeAccountTier(profile)).toBe(1);
  });

  it("returns Tier 1 for authenticated users without verification", () => {
    const profile = createProfile({ authLevel: 1 });
    expect(computeAccountTier(profile)).toBe(1);
  });

  it("returns Tier 2 for verified users without ZK/FHE", () => {
    const profile = createProfile({
      authLevel: 1,
      documentVerified: true,
      livenessPassed: true,
      faceMatchPassed: true,
    });
    expect(computeAccountTier(profile)).toBe(2);
  });

  it("returns Tier 2 when missing some identity checks", () => {
    const profile = createProfile({
      authLevel: 1,
      documentVerified: true,
      livenessPassed: true,
      faceMatchPassed: false,
    });
    expect(computeAccountTier(profile)).toBe(1);
  });

  it("returns Tier 3 for fully auditable users", () => {
    const profile = createProfile({
      authLevel: 1,
      documentVerified: true,
      livenessPassed: true,
      faceMatchPassed: true,
      zkProofsComplete: true,
      fheComplete: true,
    });
    expect(computeAccountTier(profile)).toBe(3);
  });

  it("returns Tier 2 when only ZK complete (missing FHE)", () => {
    const profile = createProfile({
      authLevel: 1,
      documentVerified: true,
      livenessPassed: true,
      faceMatchPassed: true,
      zkProofsComplete: true,
      fheComplete: false,
    });
    expect(computeAccountTier(profile)).toBe(2);
  });

  it("returns Tier 2 when only FHE complete (missing ZK)", () => {
    const profile = createProfile({
      authLevel: 1,
      documentVerified: true,
      livenessPassed: true,
      faceMatchPassed: true,
      zkProofsComplete: false,
      fheComplete: true,
    });
    expect(computeAccountTier(profile)).toBe(2);
  });
});
