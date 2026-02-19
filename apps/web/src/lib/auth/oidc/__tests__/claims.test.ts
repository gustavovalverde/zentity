import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/queries/identity", () => ({
  getVerificationStatus: vi.fn(),
  getIdentityBundleByUserId: vi.fn(),
  getLatestIdentityDocumentByUserId: vi.fn(),
}));

import {
  getIdentityBundleByUserId,
  getLatestIdentityDocumentByUserId,
  getVerificationStatus,
} from "@/lib/db/queries/identity";

import { buildOidcVerifiedClaims, buildProofClaims } from "../claims";

describe("oidc claim mapping", () => {
  beforeEach(() => {
    vi.mocked(getVerificationStatus).mockResolvedValue({
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
    vi.mocked(getIdentityBundleByUserId).mockResolvedValue({
      policyVersion: "policy-1",
      issuerId: "issuer-1",
      attestationExpiresAt: "2030-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    } as Awaited<ReturnType<typeof getIdentityBundleByUserId>>);
    vi.mocked(getLatestIdentityDocumentByUserId).mockResolvedValue({
      verifiedAt: "2026-01-02T00:00:00.000Z",
    } as Awaited<ReturnType<typeof getLatestIdentityDocumentByUserId>>);
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
      issuer_id: "issuer-1",
      verification_time: "2026-01-02T00:00:00.000Z",
      attestation_expires_at: "2030-01-01T00:00:00.000Z",
    });
  });

  it("returns verified_claims for OIDC4IDA when verified", async () => {
    const verifiedClaims = await buildOidcVerifiedClaims("user-1");

    expect(verifiedClaims).toMatchObject({
      verification: {
        trust_framework: "zentity",
        assurance_level: "full",
        policy_version: "policy-1",
        issuer_id: "issuer-1",
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

  it("returns null verified_claims when no assurance", async () => {
    vi.mocked(getVerificationStatus).mockResolvedValueOnce({
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
