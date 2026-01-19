/**
 * Compute Module Unit Tests
 *
 * Tests for pure assurance computation functions.
 * All functions here are deterministic and have no side effects.
 */

import { describe, expect, it } from "vitest";

import {
  areSignedClaimsComplete,
  areZkProofsComplete,
  computeAssuranceState,
  deriveAuthStrength,
  isFheComplete,
  REQUIRED_SIGNED_CLAIM_TYPES,
  REQUIRED_ZK_PROOF_TYPES,
} from "../compute";

describe("deriveAuthStrength", () => {
  it("returns 'strong' for passkey authentication", () => {
    expect(deriveAuthStrength("passkey")).toBe("strong");
  });

  it("returns 'basic' for other authenticated methods", () => {
    expect(deriveAuthStrength("opaque")).toBe("basic");
    expect(deriveAuthStrength("magic-link")).toBe("basic");
    expect(deriveAuthStrength("siwe")).toBe("basic");
    expect(deriveAuthStrength(null)).toBe("basic");
    expect(deriveAuthStrength(undefined)).toBe("basic");
  });
});

describe("computeAssuranceState", () => {
  describe("Tier 0 - Anonymous", () => {
    it("returns Tier 0 for unauthenticated users", () => {
      const state = computeAssuranceState({
        hasSession: false,
        loginMethod: null,
        hasSecuredKeys: false,
        documentVerified: false,
        livenessVerified: false,
        faceMatchVerified: false,
        zkProofsComplete: false,
        fheComplete: false,
        onChainAttested: false,
      });

      expect(state.tier).toBe(0);
      expect(state.tierName).toBe("Anonymous");
      expect(state.authStrength).toBe("basic");
      expect(state.loginMethod).toBe("none");
    });
  });

  describe("Tier 1 - Account", () => {
    it("returns Tier 1 for authenticated users with secured keys", () => {
      const state = computeAssuranceState({
        hasSession: true,
        loginMethod: "opaque",
        hasSecuredKeys: true,
        documentVerified: false,
        livenessVerified: false,
        faceMatchVerified: false,
        zkProofsComplete: false,
        fheComplete: false,
        onChainAttested: false,
      });

      expect(state.tier).toBe(1);
      expect(state.tierName).toBe("Account");
      expect(state.authStrength).toBe("basic");
      expect(state.loginMethod).toBe("opaque");
    });

    it("stays at Tier 1 without secured keys even if authenticated", () => {
      const state = computeAssuranceState({
        hasSession: true,
        loginMethod: "passkey",
        hasSecuredKeys: false,
        documentVerified: false,
        livenessVerified: false,
        faceMatchVerified: false,
        zkProofsComplete: false,
        fheComplete: false,
        onChainAttested: false,
      });

      expect(state.tier).toBe(0);
      expect(state.authStrength).toBe("strong");
    });

    it("detects incomplete proofs (identity done but proofs missing)", () => {
      const state = computeAssuranceState({
        hasSession: true,
        loginMethod: "passkey",
        hasSecuredKeys: true,
        documentVerified: true,
        livenessVerified: true,
        faceMatchVerified: true,
        zkProofsComplete: false,
        fheComplete: false,
        onChainAttested: false,
      });

      expect(state.tier).toBe(1);
      expect(state.details.hasIncompleteProofs).toBe(true);
    });
  });

  describe("Tier 2 - Verified", () => {
    it("returns Tier 2 for fully verified users", () => {
      const state = computeAssuranceState({
        hasSession: true,
        loginMethod: "passkey",
        hasSecuredKeys: true,
        documentVerified: true,
        livenessVerified: true,
        faceMatchVerified: true,
        zkProofsComplete: true,
        fheComplete: true,
        onChainAttested: false,
      });

      expect(state.tier).toBe(2);
      expect(state.tierName).toBe("Verified");
      expect(state.authStrength).toBe("strong");
      expect(state.details.hasIncompleteProofs).toBe(false);
    });

    it("stays at Tier 1 when missing ZK proofs", () => {
      const state = computeAssuranceState({
        hasSession: true,
        loginMethod: "passkey",
        hasSecuredKeys: true,
        documentVerified: true,
        livenessVerified: true,
        faceMatchVerified: true,
        zkProofsComplete: false,
        fheComplete: true,
        onChainAttested: false,
      });

      expect(state.tier).toBe(1);
      expect(state.details.hasIncompleteProofs).toBe(true);
    });

    it("stays at Tier 1 when missing FHE", () => {
      const state = computeAssuranceState({
        hasSession: true,
        loginMethod: "passkey",
        hasSecuredKeys: true,
        documentVerified: true,
        livenessVerified: true,
        faceMatchVerified: true,
        zkProofsComplete: true,
        fheComplete: false,
        onChainAttested: false,
      });

      expect(state.tier).toBe(1);
      expect(state.details.hasIncompleteProofs).toBe(true);
    });

    it("stays at Tier 1 when missing face match", () => {
      const state = computeAssuranceState({
        hasSession: true,
        loginMethod: "passkey",
        hasSecuredKeys: true,
        documentVerified: true,
        livenessVerified: true,
        faceMatchVerified: false,
        zkProofsComplete: true,
        fheComplete: true,
        onChainAttested: false,
      });

      expect(state.tier).toBe(1);
      expect(state.details.hasIncompleteProofs).toBe(false);
    });
  });

  describe("details population", () => {
    it("populates all details fields correctly", () => {
      const state = computeAssuranceState({
        hasSession: true,
        loginMethod: "passkey",
        hasSecuredKeys: true,
        documentVerified: true,
        livenessVerified: true,
        faceMatchVerified: true,
        zkProofsComplete: true,
        fheComplete: true,
        onChainAttested: true,
      });

      expect(state.details).toEqual({
        isAuthenticated: true,
        hasSecuredKeys: true,
        documentVerified: true,
        livenessVerified: true,
        faceMatchVerified: true,
        zkProofsComplete: true,
        fheComplete: true,
        hasIncompleteProofs: false,
        onChainAttested: true,
      });
    });
  });
});

describe("areZkProofsComplete", () => {
  it("returns false when no proofs", () => {
    expect(areZkProofsComplete([])).toBe(false);
  });

  it("returns false when missing proofs", () => {
    expect(areZkProofsComplete(["age_verification"])).toBe(false);
  });

  it("returns true when all required proofs present", () => {
    expect(areZkProofsComplete([...REQUIRED_ZK_PROOF_TYPES])).toBe(true);
  });

  it("returns true with extra proofs", () => {
    expect(
      areZkProofsComplete([...REQUIRED_ZK_PROOF_TYPES, "identity_binding"])
    ).toBe(true);
  });
});

describe("areSignedClaimsComplete", () => {
  it("returns false when no claims", () => {
    expect(areSignedClaimsComplete([])).toBe(false);
  });

  it("returns false when missing claims", () => {
    expect(areSignedClaimsComplete(["ocr_result"])).toBe(false);
  });

  it("returns true when all required claims present", () => {
    expect(areSignedClaimsComplete([...REQUIRED_SIGNED_CLAIM_TYPES])).toBe(
      true
    );
  });
});

describe("isFheComplete", () => {
  it("returns false when no attributes", () => {
    expect(isFheComplete([])).toBe(false);
  });

  it("returns true with birth_year_offset", () => {
    expect(isFheComplete(["birth_year_offset"])).toBe(true);
  });

  it("returns true with dob_days", () => {
    expect(isFheComplete(["dob_days"])).toBe(true);
  });

  it("returns true with both formats", () => {
    expect(isFheComplete(["birth_year_offset", "dob_days"])).toBe(true);
  });
});
