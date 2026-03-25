import type { AccountAssurance } from "@/lib/assurance/types";

import { describe, expect, it } from "vitest";

import { computeInitialStep } from "../steps";

function makeAssurance(
  overrides: Partial<AccountAssurance["details"]> & {
    tier?: AccountAssurance["tier"];
  } = {}
): AccountAssurance {
  const { tier = 1, ...detailOverrides } = overrides;
  const tierNames = {
    0: "Anonymous" as const,
    1: "Account" as const,
    2: "Verified" as const,
    3: "Chip Verified" as const,
  };
  return {
    tier,
    tierName: tierNames[tier],
    details: {
      isAuthenticated: true,
      hasSecuredKeys: true,
      chipVerified: false,
      documentVerified: false,
      faceMatchVerified: false,
      fheComplete: false,
      hasIncompleteProofs: false,
      livenessVerified: false,
      missingProfileSecret: false,
      needsDocumentReprocessing: false,
      onChainAttested: false,
      zkProofsComplete: false,
      ...detailOverrides,
    },
  };
}

const defaultOptions = { hasEnrollment: true, zkPassportEnabled: false };

describe("computeInitialStep", () => {
  it("returns null for tier 3 users (redirect to dashboard)", () => {
    const assurance = makeAssurance({ tier: 3, chipVerified: true });
    expect(computeInitialStep(assurance, defaultOptions)).toBeNull();
  });

  it("returns 'method' for tier 3 users with missing profile secret", () => {
    const assurance = makeAssurance({
      tier: 3,
      chipVerified: true,
      missingProfileSecret: true,
    });
    const result = computeInitialStep(assurance, defaultOptions);
    expect(result?.step).toBe("method");
    expect(result?.context.missingProfileSecret).toBe(true);
  });

  it("returns 'method' for tier 2 users with missing profile secret", () => {
    const assurance = makeAssurance({
      tier: 2,
      missingProfileSecret: true,
    });
    const result = computeInitialStep(assurance, defaultOptions);
    expect(result?.step).toBe("method");
    expect(result?.context.missingProfileSecret).toBe(true);
  });

  it("returns 'method' for tier 2 users with zkPassport upgrade path", () => {
    const assurance = makeAssurance({ tier: 2 });
    const result = computeInitialStep(assurance, {
      hasEnrollment: true,
      zkPassportEnabled: true,
    });
    expect(result?.step).toBe("method");
    expect(result?.context.missingProfileSecret).toBe(false);
  });

  it("returns null for tier 2 users without zkPassport (nothing to do)", () => {
    const assurance = makeAssurance({ tier: 2 });
    expect(computeInitialStep(assurance, defaultOptions)).toBeNull();
  });

  it("returns 'enrollment' when user has no FHE keys", () => {
    const assurance = makeAssurance();
    const result = computeInitialStep(assurance, {
      hasEnrollment: false,
      zkPassportEnabled: false,
    });
    expect(result?.step).toBe("enrollment");
  });

  it("returns 'document' with resetOnMount for incomplete proofs", () => {
    const assurance = makeAssurance({
      documentVerified: true,
      livenessVerified: true,
      faceMatchVerified: true,
      hasIncompleteProofs: true,
    });
    const result = computeInitialStep(assurance, defaultOptions);
    expect(result?.step).toBe("document");
    expect(result?.context.resetOnMount).toBe(true);
  });

  it("returns 'document' with resetOnMount when needs document reprocessing", () => {
    const assurance = makeAssurance({ needsDocumentReprocessing: true });
    const result = computeInitialStep(assurance, defaultOptions);
    expect(result?.step).toBe("document");
    expect(result?.context.resetOnMount).toBe(true);
  });

  it("returns 'liveness' when document is done but liveness is not", () => {
    const assurance = makeAssurance({ documentVerified: true });
    const result = computeInitialStep(assurance, defaultOptions);
    expect(result?.step).toBe("liveness");
    expect(result?.context.resetOnMount).toBe(false);
  });

  it("returns 'method' for fresh tier 1 user with enrollment", () => {
    const assurance = makeAssurance();
    const result = computeInitialStep(assurance, defaultOptions);
    expect(result?.step).toBe("method");
  });

  it("returns 'enrollment' for tier 0 user without enrollment", () => {
    const assurance = makeAssurance({ tier: 0, isAuthenticated: false });
    const result = computeInitialStep(assurance, {
      hasEnrollment: false,
      zkPassportEnabled: false,
    });
    expect(result?.step).toBe("enrollment");
  });

  it("prioritizes missingProfileSecret over zkPassport upgrade at tier 2", () => {
    const assurance = makeAssurance({
      tier: 2,
      missingProfileSecret: true,
    });
    const result = computeInitialStep(assurance, {
      hasEnrollment: true,
      zkPassportEnabled: true,
    });
    expect(result?.step).toBe("method");
    expect(result?.context.missingProfileSecret).toBe(true);
  });
});
