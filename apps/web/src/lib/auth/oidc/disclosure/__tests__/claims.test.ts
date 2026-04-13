import { beforeEach, describe, expect, it, vi } from "vitest";

vi.resetModules();

const mockGetVerificationReadModel = vi.fn();

vi.doMock("@/lib/identity/verification/read-model", () => ({
  getVerificationReadModel: mockGetVerificationReadModel,
}));

const { buildOidcVerifiedClaims, buildProofClaims } = await import("../claims");

function makeModel(overrides: Record<string, unknown> = {}) {
  return {
    method: "ocr",
    verificationId: "v-1",
    verifiedAt: "2026-01-02T00:00:00.000Z",
    issuerCountry: "USA",
    compliance: {
      level: "full",
      numericLevel: 3,
      verified: true,
      birthYearOffset: null,
      checks: {
        documentVerified: true,
        livenessVerified: true,
        ageVerified: true,
        faceMatchVerified: true,
        nationalityVerified: true,
        identityBound: true,
        sybilResistant: true,
      },
    },
    checks: [],
    proofs: [],
    bundle: {
      exists: true,
      fheKeyId: "fhe-1",
      policyVersion: "policy-1",
      attestationExpiresAt: "2030-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    fhe: { complete: true, attributeTypes: [] },
    vault: { hasProfileSecret: true },
    onChainAttested: false,
    needsDocumentReprocessing: false,
    ...overrides,
  };
}

describe("oidc claim mapping", () => {
  beforeEach(() => {
    mockGetVerificationReadModel.mockResolvedValue(makeModel());
  });

  it("builds derived proof claims from verification data", async () => {
    const claims = await buildProofClaims("user-1");

    expect(claims).toMatchObject({
      verification_level: "full",
      verified: true,
      document_verified: true,
      liveness_verified: true,
      age_verification: true,
      nationality_verified: true,
      nationality_group: "GLOBAL",
      face_match_verified: true,
      identity_bound: true,
      sybil_resistant: true,
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
        identity_bound: true,
      },
    });
  });

  it("builds chip-verified claims with correct check mappings", async () => {
    mockGetVerificationReadModel.mockResolvedValueOnce(
      makeModel({
        method: "nfc_chip",
        compliance: {
          level: "chip",
          numericLevel: 4,
          verified: true,
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
      })
    );

    const claims = await buildProofClaims("user-chip");

    expect(claims).toMatchObject({
      verification_level: "chip",
      verified: true,
      chip_verified: true,
      chip_verification_method: "nfc",
      document_verified: true,
      liveness_verified: true,
      age_verification: true,
      nationality_verified: true,
      nationality_group: "GLOBAL",
      face_match_verified: true,
      identity_bound: true,
      sybil_resistant: true,
    });
  });

  it("builds chip-verified OIDC4IDA claims", async () => {
    mockGetVerificationReadModel.mockResolvedValueOnce(
      makeModel({
        method: "nfc_chip",
        compliance: {
          level: "chip",
          numericLevel: 4,
          verified: true,
          birthYearOffset: null,
          checks: {
            documentVerified: true,
            livenessVerified: true,
            ageVerified: true,
            nationalityVerified: true,
            faceMatchVerified: false,
            identityBound: true,
            sybilResistant: true,
          },
        },
      })
    );

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
    mockGetVerificationReadModel.mockResolvedValueOnce(
      makeModel({
        method: null,
        verifiedAt: null,
        compliance: {
          level: "none",
          numericLevel: 1,
          verified: false,
          birthYearOffset: null,
          checks: {
            documentVerified: false,
            livenessVerified: false,
            ageVerified: false,
            nationalityVerified: false,
            faceMatchVerified: false,
            identityBound: false,
            sybilResistant: false,
          },
        },
      })
    );

    const verifiedClaims = await buildOidcVerifiedClaims("user-2");
    expect(verifiedClaims).toBeNull();
  });
});
