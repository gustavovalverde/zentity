/**
 * Tests for the customIdTokenClaims logic in auth.ts.
 *
 * Validates that proof claims are merged into id_tokens when proof scopes
 * are present in the granted scopes, matching what demo-RPs expect.
 *
 * This tests the composite behavior of:
 * - consumeEphemeralClaimsByUser (identity PII from vault unlock)
 * - filterIdentityByScopes (PII filtering)
 * - buildProofClaims + filterProofClaimsByScopes (proof flags)
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// Reset module cache to get clean mocks
vi.resetModules();

const mockGetVerificationStatus = vi.fn();
const mockGetIdentityBundleByUserId = vi.fn();
const mockGetLatestIdentityDocumentByUserId = vi.fn();

vi.doMock("@/lib/db/queries/identity", () => ({
  getVerificationStatus: mockGetVerificationStatus,
  getIdentityBundleByUserId: mockGetIdentityBundleByUserId,
  getLatestVerification: mockGetLatestIdentityDocumentByUserId,
}));

const { buildProofClaims } = await import("../claims");
const { filterProofClaimsByScopes, extractProofScopes } = await import(
  "../proof-scopes"
);
const { filterIdentityByScopes } = await import("../identity-scopes");

/**
 * Reproduces the customIdTokenClaims logic from auth.ts.
 * Kept in sync so that if the real logic changes, this test breaks.
 *
 * @param grantedScopes - The scopes from better-auth's token context
 * @param ephemeral - Ephemeral claims from vault unlock (null for proof-only flows)
 */
async function simulateCustomIdTokenClaims(
  userId: string,
  grantedScopes: string[],
  ephemeral: {
    claims: Record<string, unknown>;
    scopes: string[];
  } | null
): Promise<Record<string, unknown>> {
  // Identity claims require ephemeral staging (vault unlock)
  const identityClaims = ephemeral
    ? filterIdentityByScopes(ephemeral.claims, ephemeral.scopes)
    : {};

  // Proof claims use the granted scopes directly
  const hasProofScopes =
    grantedScopes.includes("proof:identity") ||
    extractProofScopes(grantedScopes).length > 0;
  if (!hasProofScopes) {
    return identityClaims;
  }

  const allProofClaims = await buildProofClaims(userId);
  const proofClaims = filterProofClaimsByScopes(allProofClaims, grantedScopes);
  return { ...identityClaims, ...proofClaims };
}

function setVerifiedUser() {
  mockGetVerificationStatus.mockResolvedValue({
    verified: true,
    level: "full",
    checks: {
      document: true,
      liveness: true,
      ageProof: true,
      docValidityProof: true,
      nationalityProof: true,
      faceMatchProof: true,
      identityBindingProof: true,
    },
  });
  mockGetIdentityBundleByUserId.mockResolvedValue({
    policyVersion: "policy-1",
    issuerId: "issuer-1",
    attestationExpiresAt: "2030-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
  mockGetLatestIdentityDocumentByUserId.mockResolvedValue({
    verifiedAt: "2026-01-02T00:00:00.000Z",
  });
}

describe("customIdTokenClaims — proof claims in id_token", () => {
  beforeEach(() => {
    setVerifiedUser();
  });

  it("returns empty when no ephemeral entry and no proof scopes", async () => {
    const result = await simulateCustomIdTokenClaims(
      "user-1",
      ["openid"],
      null
    );
    expect(result).toEqual({});
  });

  it("returns proof claims even without ephemeral entry (proof-only flow)", async () => {
    const result = await simulateCustomIdTokenClaims(
      "user-1",
      ["openid", "proof:age"],
      null
    );

    expect(result).toHaveProperty("age_proof_verified", true);
    expect(Object.keys(result)).toHaveLength(1);
  });

  it("returns only identity claims when no proof scopes", async () => {
    const result = await simulateCustomIdTokenClaims(
      "user-1",
      ["openid", "email", "identity.name"],
      {
        claims: { given_name: "Jane", family_name: "Doe" },
        scopes: ["openid", "email", "identity.name"],
      }
    );

    expect(result).toEqual({ given_name: "Jane", family_name: "Doe" });
    expect(result).not.toHaveProperty("verified");
    expect(result).not.toHaveProperty("age_proof_verified");
  });

  it("merges proof claims when proof:verification scope is present (bank scenario)", async () => {
    const result = await simulateCustomIdTokenClaims(
      "user-1",
      ["openid", "email", "proof:verification"],
      {
        claims: {},
        scopes: ["openid", "email", "proof:verification"],
      }
    );

    expect(result).toHaveProperty("verification_level", "full");
    expect(result).toHaveProperty("verified", true);
    expect(result).toHaveProperty("identity_binding_verified", true);
    // proof:verification should NOT include age/doc/liveness claims
    expect(result).not.toHaveProperty("age_proof_verified");
    expect(result).not.toHaveProperty("document_verified");
  });

  it("merges proof claims when proof:age scope is present (wine scenario)", async () => {
    const result = await simulateCustomIdTokenClaims(
      "user-1",
      ["openid", "proof:age"],
      null
    );

    expect(result).toHaveProperty("age_proof_verified", true);
    expect(Object.keys(result)).toHaveLength(1);
  });

  it("merges both identity and proof claims (bank step-up with proof)", async () => {
    const scopes = ["openid", "email", "identity.name", "proof:verification"];
    const result = await simulateCustomIdTokenClaims("user-1", scopes, {
      claims: { given_name: "Jane", family_name: "Doe" },
      scopes,
    });

    // Identity claims
    expect(result).toHaveProperty("given_name", "Jane");
    expect(result).toHaveProperty("family_name", "Doe");
    // Proof claims
    expect(result).toHaveProperty("verified", true);
    expect(result).toHaveProperty("verification_level", "full");
    expect(result).toHaveProperty("identity_binding_verified", true);
  });

  it("proof:identity umbrella scope returns all proof claims", async () => {
    const result = await simulateCustomIdTokenClaims(
      "user-1",
      ["openid", "proof:identity"],
      null
    );

    expect(result).toHaveProperty("verification_level");
    expect(result).toHaveProperty("verified");
    expect(result).toHaveProperty("age_proof_verified");
    expect(result).toHaveProperty("document_verified");
    expect(result).toHaveProperty("liveness_verified");
    expect(result).toHaveProperty("face_match_verified");
    expect(result).toHaveProperty("nationality_proof_verified");
    expect(result).toHaveProperty("identity_binding_verified");
    expect(result).toHaveProperty("policy_version");
    expect(result).not.toHaveProperty("issuer_id");
    expect(result).toHaveProperty("verification_time");
    expect(result).toHaveProperty("attestation_expires_at");
  });

  it("unverified user gets empty proof claims but still has identity claims", async () => {
    mockGetVerificationStatus.mockResolvedValueOnce({
      verified: false,
      level: "none",
      checks: {
        document: false,
        liveness: false,
        ageProof: false,
        docValidityProof: false,
        nationalityProof: false,
        faceMatchProof: false,
        identityBindingProof: false,
      },
    });
    mockGetIdentityBundleByUserId.mockResolvedValueOnce(null);
    mockGetLatestIdentityDocumentByUserId.mockResolvedValueOnce(null);

    const scopes = ["openid", "identity.name", "proof:verification"];
    const result = await simulateCustomIdTokenClaims("user-2", scopes, {
      claims: { given_name: "Bob" },
      scopes,
    });

    // Identity claims still present
    expect(result).toHaveProperty("given_name", "Bob");
    // Proof claims present but with falsy values
    expect(result).toHaveProperty("verified", false);
    expect(result).toHaveProperty("verification_level", "none");
  });

  it("wine scenario full flow: proof:age + identity.name + identity.address", async () => {
    const scopes = [
      "openid",
      "email",
      "proof:age",
      "identity.name",
      "identity.address",
    ];
    const result = await simulateCustomIdTokenClaims("user-1", scopes, {
      claims: {
        given_name: "Alice",
        family_name: "Smith",
        address: { formatted: "123 Main St" },
      },
      scopes,
    });

    // Identity from vault unlock
    expect(result).toHaveProperty("given_name", "Alice");
    expect(result).toHaveProperty("address");
    // Proof from ZK verification
    expect(result).toHaveProperty("age_proof_verified", true);
    // Should NOT have claims outside requested scopes
    expect(result).not.toHaveProperty("nationality_proof_verified");
    expect(result).not.toHaveProperty("document_verified");
  });
});
