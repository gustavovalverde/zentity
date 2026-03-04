import { beforeEach, describe, expect, it, vi } from "vitest";

// Reset module cache to avoid vmThreads mock registry leakage
// where a previous test file's vi.mock for the same module persists.
vi.resetModules();

const mockGetVerificationStatus = vi.fn();
const mockGetIdentityBundleByUserId = vi.fn();
const mockGetLatestIdentityDocumentByUserId = vi.fn();

vi.doMock("@/lib/db/queries/identity", () => ({
  getVerificationStatus: mockGetVerificationStatus,
  getIdentityBundleByUserId: mockGetIdentityBundleByUserId,
  getLatestVerification: mockGetLatestIdentityDocumentByUserId,
}));

const { buildOidcVerifiedClaims, buildProofClaims } = await import("../claims");

describe("oidc claim mapping", () => {
  beforeEach(() => {
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
  });

  it("builds derived proof claims from verification data", async () => {
    const claims = await buildProofClaims("user-1");

    expect(claims).toMatchObject({
      verification_level: "full",
      verified: true,
      document_verified: true,
      liveness_verified: true,
      age_proof_verified: true,
      doc_validity_proof_verified: true,
      nationality_proof_verified: true,
      face_match_verified: true,
      identity_binding_verified: true,
      policy_version: "policy-1",
      verification_time: "2026-01-02T00:00:00.000Z",
      attestation_expires_at: "2030-01-01T00:00:00.000Z",
    });
    expect(claims).not.toHaveProperty("issuer_id");
  });

  it("returns verified_claims for OIDC4IDA when verified", async () => {
    const verifiedClaims = await buildOidcVerifiedClaims("user-1");

    expect(verifiedClaims).toMatchObject({
      verification: {
        trust_framework: "eidas",
        assurance_level: "full",
        policy_version: "policy-1",
        attestation_expires_at: "2030-01-01T00:00:00.000Z",
      },
      claims: {
        verification_level: "full",
        verified: true,
        document_verified: true,
        identity_binding_verified: true,
      },
    });
  });

  it("builds chip-verified claims with correct check mappings", async () => {
    mockGetVerificationStatus.mockResolvedValueOnce({
      verified: true,
      level: "chip",
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

    const claims = await buildProofClaims("user-chip");

    expect(claims).toMatchObject({
      verification_level: "chip",
      verified: true,
      chip_verified: true,
      chip_verification_method: "nfc",
      document_verified: true,
      liveness_verified: true,
      age_proof_verified: true,
      doc_validity_proof_verified: true,
      nationality_proof_verified: true,
      face_match_verified: true,
      identity_binding_verified: true,
    });
  });

  it("builds chip-verified OIDC4IDA claims", async () => {
    mockGetVerificationStatus.mockResolvedValueOnce({
      verified: true,
      level: "chip",
      checks: {
        document: true,
        liveness: true,
        ageProof: true,
        docValidityProof: true,
        nationalityProof: true,
        faceMatchProof: false,
        identityBindingProof: true,
      },
    });

    const verifiedClaims = await buildOidcVerifiedClaims("user-chip");

    expect(verifiedClaims).toMatchObject({
      verification: {
        trust_framework: "eidas",
        assurance_level: "chip",
      },
      claims: {
        verification_level: "chip",
        verified: true,
        chip_verified: true,
        chip_verification_method: "nfc",
        face_match_verified: false,
      },
    });
  });

  it("returns null verified_claims when no assurance", async () => {
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

    const verifiedClaims = await buildOidcVerifiedClaims("user-2");
    expect(verifiedClaims).toBeNull();
  });
});
