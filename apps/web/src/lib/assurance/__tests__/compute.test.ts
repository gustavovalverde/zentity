import { describe, expect, it } from "vitest";

import {
  computeAccountAssurance,
  deriveAuthStrength,
  isFheComplete,
} from "../compute";

describe("computeAccountAssurance", () => {
  it("returns tier 0 for unauthenticated users", () => {
    const assurance = computeAccountAssurance({
      isAuthenticated: false,
      hasSecuredKeys: false,
      chipVerified: false,
      documentVerified: false,
      livenessVerified: false,
      faceMatchVerified: false,
      zkProofsComplete: false,
      fheComplete: false,
      onChainAttested: false,
    });

    expect(assurance.tier).toBe(0);
    expect(assurance.tierName).toBe("Anonymous");
  });

  it("returns tier 1 for authenticated users with secured keys", () => {
    const assurance = computeAccountAssurance({
      isAuthenticated: true,
      hasSecuredKeys: true,
      chipVerified: false,
      documentVerified: false,
      livenessVerified: false,
      faceMatchVerified: false,
      zkProofsComplete: false,
      fheComplete: false,
      onChainAttested: false,
    });

    expect(assurance.tier).toBe(1);
    expect(assurance.tierName).toBe("Account");
  });

  it("flags incomplete proofs when identity checks passed but proofs are missing", () => {
    const assurance = computeAccountAssurance({
      isAuthenticated: true,
      hasSecuredKeys: true,
      chipVerified: false,
      documentVerified: true,
      livenessVerified: true,
      faceMatchVerified: true,
      zkProofsComplete: false,
      fheComplete: false,
      onChainAttested: false,
    });

    expect(assurance.tier).toBe(1);
    expect(assurance.details.hasIncompleteProofs).toBe(true);
  });

  it("returns tier 2 for fully verified users", () => {
    const assurance = computeAccountAssurance({
      isAuthenticated: true,
      hasSecuredKeys: true,
      chipVerified: false,
      documentVerified: true,
      livenessVerified: true,
      faceMatchVerified: true,
      zkProofsComplete: true,
      fheComplete: true,
      onChainAttested: true,
    });

    expect(assurance.tier).toBe(2);
    expect(assurance.tierName).toBe("Verified");
    expect(assurance.details.onChainAttested).toBe(true);
  });

  it("returns tier 3 for chip-verified users with FHE complete", () => {
    const assurance = computeAccountAssurance({
      isAuthenticated: true,
      hasSecuredKeys: true,
      chipVerified: true,
      documentVerified: false,
      livenessVerified: false,
      faceMatchVerified: false,
      zkProofsComplete: false,
      fheComplete: true,
      onChainAttested: false,
    });

    expect(assurance.tier).toBe(3);
    expect(assurance.tierName).toBe("Chip Verified");
  });

  it("keeps tier 1 when FHE is pending even if OCR proofs are complete", () => {
    const assurance = computeAccountAssurance({
      isAuthenticated: true,
      hasSecuredKeys: true,
      chipVerified: false,
      documentVerified: true,
      livenessVerified: true,
      faceMatchVerified: true,
      zkProofsComplete: true,
      fheComplete: false,
      onChainAttested: false,
    });

    expect(assurance.tier).toBe(1);
    expect(assurance.details.hasIncompleteProofs).toBe(false);
  });

  it("preserves missingProfileSecret and reprocessing flags", () => {
    const assurance = computeAccountAssurance({
      isAuthenticated: true,
      hasSecuredKeys: true,
      chipVerified: false,
      documentVerified: true,
      livenessVerified: true,
      faceMatchVerified: true,
      zkProofsComplete: true,
      fheComplete: true,
      onChainAttested: false,
      missingProfileSecret: true,
      needsDocumentReprocessing: true,
    });

    expect(assurance.details.missingProfileSecret).toBe(true);
    expect(assurance.details.needsDocumentReprocessing).toBe(true);
  });
});

describe("deriveAuthStrength", () => {
  it("treats passkey as strong auth", () => {
    expect(deriveAuthStrength("passkey")).toBe("strong");
  });

  it("treats non-passkey methods as basic auth", () => {
    expect(deriveAuthStrength("opaque")).toBe("basic");
    expect(deriveAuthStrength("oauth")).toBe("basic");
    expect(deriveAuthStrength(null)).toBe("basic");
  });
});

describe("isFheComplete", () => {
  it("returns true when both required encrypted attributes exist", () => {
    expect(isFheComplete(["birth_year_offset", "liveness_score"])).toBe(true);
    expect(isFheComplete(["dob_days", "liveness_score"])).toBe(true);
  });

  it("returns false when either required encrypted attribute is missing", () => {
    expect(isFheComplete(["birth_year_offset"])).toBe(false);
    expect(isFheComplete(["liveness_score"])).toBe(false);
    expect(isFheComplete([])).toBe(false);
  });
});
