/**
 * Tests for the ID token proof-claim projection used by auth-config.ts.
 *
 * Identity PII is delivered through userinfo; this suite only verifies
 * the proof-claim projection that remains eligible for ID tokens.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.resetModules();

const mockGetVerificationReadModel = vi.fn();

vi.doMock("@/lib/identity/verification/read-model", () => ({
  getVerificationReadModel: mockGetVerificationReadModel,
}));

const { buildProofClaims } = await import("../claims");
const { extractProofScopes, filterProofClaimsByScopes } = await import(
  "../registry"
);

async function simulateIdTokenProofClaims(
  userId: string,
  grantedScopes: string[]
): Promise<Record<string, unknown>> {
  const hasProofScopes =
    grantedScopes.includes("proof:identity") ||
    extractProofScopes(grantedScopes).length > 0;
  if (!hasProofScopes) {
    return {};
  }

  const allProofClaims = await buildProofClaims(userId);
  return filterProofClaimsByScopes(allProofClaims, grantedScopes, "id_token");
}

function setVerifiedUser() {
  mockGetVerificationReadModel.mockResolvedValue({
    method: "ocr",
    verificationId: "verification-1",
    verifiedAt: "2026-01-02T00:00:00.000Z",
    issuerCountry: "PT",
    compliance: {
      verified: true,
      level: "full",
      numericLevel: 3,
      birthYearOffset: null,
      checks: {
        documentVerified: true,
        livenessVerified: true,
        ageVerified: true,
        nationalityVerified: true,
        faceMatchVerified: true,
        identityBound: true,
        sybilResistant: true,
      },
    },
    checks: [],
    proofs: [],
    bundle: {
      policyVersion: "policy-1",
      issuerId: "issuer-1",
      attestationExpiresAt: "2030-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    fhe: {
      complete: true,
      attributeTypes: [],
    },
    vault: {
      hasProfileSecret: true,
    },
    onChainAttested: false,
    needsDocumentReprocessing: false,
  });
}

describe("ID token proof claim projection", () => {
  beforeEach(() => {
    setVerifiedUser();
  });

  it("returns no custom claims for openid-only requests", async () => {
    const result = await simulateIdTokenProofClaims("user-1", ["openid"]);
    expect(result).toEqual({});
  });

  it("keeps identity scopes out of the id_token projection", async () => {
    const result = await simulateIdTokenProofClaims("user-1", [
      "openid",
      "identity.name",
      "identity.address",
    ]);

    expect(result).toEqual({});
    expect(result).not.toHaveProperty("given_name");
    expect(result).not.toHaveProperty("address");
  });

  it("returns proof claims for proof-only requests", async () => {
    const result = await simulateIdTokenProofClaims("user-1", [
      "openid",
      "proof:age",
    ]);

    expect(result).toEqual({ age_verification: true });
  });

  it("ignores identity scopes when proof scopes are also present", async () => {
    const result = await simulateIdTokenProofClaims("user-1", [
      "openid",
      "identity.name",
      "proof:verification",
    ]);

    expect(result).toHaveProperty("verification_level", "full");
    expect(result).toHaveProperty("verified", true);
    expect(result).toHaveProperty("identity_bound", true);
    expect(result).not.toHaveProperty("given_name");
  });

  it("expands proof:identity to the full proof claim set", async () => {
    const result = await simulateIdTokenProofClaims("user-1", [
      "openid",
      "proof:identity",
    ]);

    expect(result).toHaveProperty("verification_level", "full");
    expect(result).toHaveProperty("verified", true);
    expect(result).toHaveProperty("age_verification", true);
    expect(result).toHaveProperty("document_verified", true);
    expect(result).toHaveProperty("liveness_verified", true);
    expect(result).toHaveProperty("face_match_verified", true);
    expect(result).toHaveProperty("nationality_verified", true);
    expect(result).toHaveProperty("nationality_group", "GLOBAL");
    expect(result).toHaveProperty("identity_bound", true);
    expect(result).toHaveProperty("sybil_resistant", true);
    expect(result).toHaveProperty("policy_version", "policy-1");
    expect(result).toHaveProperty("verification_time");
    expect(result).toHaveProperty("attestation_expires_at");
    expect(result).not.toHaveProperty("issuer_id");
  });
});
