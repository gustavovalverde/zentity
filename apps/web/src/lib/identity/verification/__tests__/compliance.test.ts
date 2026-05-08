import { describe, expect, it } from "vitest";

import {
  COMPLIANCE_ONCHAIN_TIERS,
  complianceOnchainTier,
  deriveComplianceStatus,
} from "../compliance";

type ComplianceInput = Parameters<typeof deriveComplianceStatus>[0];

function makeInput(overrides: Partial<ComplianceInput> = {}): ComplianceInput {
  return {
    verificationMethod: null,
    birthYearOffset: null,
    zkProofs: [],
    signedClaims: [],
    hasDocumentSybilSignal: false,
    hasHumanityCredential: false,
    hasNationalityCommitment: false,
    ...overrides,
  };
}

const ALL_OCR_PROOFS = [
  "age_verification",
  "doc_validity",
  "nationality_membership",
  "face_match",
  "identity_binding",
].map((proofType) => ({ proofType, verified: true }));

const ALL_OCR_CLAIMS = ["liveness_score", "face_match_score"].map(
  (claimType) => ({ claimType })
);

describe("deriveComplianceStatus", () => {
  describe("no verification", () => {
    it("returns unverified identity with empty checks", () => {
      const result = deriveComplianceStatus(makeInput());
      expect(result.identity.verified).toBe(false);
      expect(result.identity.method).toBeNull();
      expect(result.identity.strength).toBe("none");
      expect(result.humanity.proven).toBe(false);
      expect(
        Object.values(result.policy.checks).every((value) => value === false)
      ).toBe(true);
    });

    it("flags humanity-only accounts as proven without identity", () => {
      const result = deriveComplianceStatus(
        makeInput({ hasHumanityCredential: true })
      );

      expect(result.identity.verified).toBe(false);
      expect(result.identity.strength).toBe("none");
      expect(result.humanity.proven).toBe(true);
      expect(result.policy.checks).toEqual({
        documentVerified: false,
        livenessVerified: false,
        ageVerified: false,
        faceMatchVerified: false,
        nationalityVerified: false,
        identityBound: false,
        sybilResistant: true,
      });
    });
  });

  describe("birthYearOffset validation", () => {
    it("passes through valid offset", () => {
      const result = deriveComplianceStatus(makeInput({ birthYearOffset: 25 }));
      expect(result.policy.birthYearOffset).toBe(25);
    });

    it("passes through 0 and 255 boundaries", () => {
      expect(
        deriveComplianceStatus(makeInput({ birthYearOffset: 0 })).policy
          .birthYearOffset
      ).toBe(0);
      expect(
        deriveComplianceStatus(makeInput({ birthYearOffset: 255 })).policy
          .birthYearOffset
      ).toBe(255);
    });

    it("rejects out-of-range or non-integer values", () => {
      for (const value of [-1, 256, 25.5]) {
        const result = deriveComplianceStatus(
          makeInput({ birthYearOffset: value })
        );
        expect(result.policy.birthYearOffset).toBeNull();
      }
    });
  });

  describe("OCR path", () => {
    it("returns documentary strength when only the document proof verifies", () => {
      const result = deriveComplianceStatus(
        makeInput({
          verificationMethod: "ocr",
          zkProofs: [{ proofType: "doc_validity", verified: true }],
        })
      );
      expect(result.identity.method).toBe("ocr");
      expect(result.identity.strength).toBe("documentary");
      expect(result.identity.verified).toBe(false);
      expect(result.policy.checks.documentVerified).toBe(true);
    });

    it("returns documentary_full when doc + liveness + face_match + age pass", () => {
      const result = deriveComplianceStatus(
        makeInput({
          verificationMethod: "ocr",
          zkProofs: ALL_OCR_PROOFS,
          signedClaims: ALL_OCR_CLAIMS,
          hasDocumentSybilSignal: true,
        })
      );
      expect(result.identity.strength).toBe("documentary_full");
      expect(result.identity.verified).toBe(true);
      expect(complianceOnchainTier(result)).toBe(
        COMPLIANCE_ONCHAIN_TIERS.documentary_full
      );
    });

    it("sybilResistant requires document or humanity signal", () => {
      const result = deriveComplianceStatus(
        makeInput({
          verificationMethod: "ocr",
          zkProofs: ALL_OCR_PROOFS,
          signedClaims: ALL_OCR_CLAIMS,
          hasDocumentSybilSignal: false,
          hasHumanityCredential: false,
        })
      );
      expect(result.policy.checks.sybilResistant).toBe(false);
      expect(result.identity.verified).toBe(false);
    });

    it("uses humanity as the OCR sybil-resistant signal", () => {
      const result = deriveComplianceStatus(
        makeInput({
          verificationMethod: "ocr",
          zkProofs: ALL_OCR_PROOFS,
          signedClaims: ALL_OCR_CLAIMS,
          hasDocumentSybilSignal: false,
          hasHumanityCredential: true,
        })
      );

      expect(result.policy.checks.sybilResistant).toBe(true);
      expect(result.humanity.proven).toBe(true);
      expect(result.identity.verified).toBe(true);
    });
  });

  describe("NFC chip path", () => {
    it("reaches cryptographic_chip when chip claim and sybil signal present", () => {
      const result = deriveComplianceStatus(
        makeInput({
          verificationMethod: "nfc_chip",
          signedClaims: [{ claimType: "chip_verification" }],
          hasDocumentSybilSignal: true,
          hasNationalityCommitment: true,
        })
      );
      expect(result.identity.method).toBe("nfc_chip");
      expect(result.identity.strength).toBe("cryptographic_chip");
      expect(result.identity.verified).toBe(true);
      expect(result.policy.checks.nationalityVerified).toBe(true);
      expect(complianceOnchainTier(result)).toBe(
        COMPLIANCE_ONCHAIN_TIERS.cryptographic_chip
      );
    });

    it("treats chip-only as cryptographic_chip even without nationality", () => {
      const result = deriveComplianceStatus(
        makeInput({
          verificationMethod: "nfc_chip",
          signedClaims: [{ claimType: "chip_verification" }],
          hasDocumentSybilSignal: true,
          hasNationalityCommitment: false,
        })
      );
      expect(result.identity.strength).toBe("cryptographic_chip");
      expect(result.policy.checks.nationalityVerified).toBe(false);
    });

    it("uses humanity as NFC sybil-resistant signal without identity-binding it", () => {
      const result = deriveComplianceStatus(
        makeInput({
          verificationMethod: "nfc_chip",
          signedClaims: [{ claimType: "chip_verification" }],
          hasDocumentSybilSignal: false,
          hasHumanityCredential: true,
          hasNationalityCommitment: true,
        })
      );

      expect(result.policy.checks.identityBound).toBe(false);
      expect(result.policy.checks.sybilResistant).toBe(true);
      expect(result.identity.strength).toBe("cryptographic_chip");
    });
  });

  describe("on-chain encoding", () => {
    it("maps strengths to integer uint8 tiers", () => {
      expect(COMPLIANCE_ONCHAIN_TIERS.none).toBe(0);
      expect(COMPLIANCE_ONCHAIN_TIERS.documentary).toBe(1);
      expect(COMPLIANCE_ONCHAIN_TIERS.documentary_full).toBe(2);
      expect(COMPLIANCE_ONCHAIN_TIERS.cryptographic_chip).toBe(3);
    });

    it("returns 0 for users with no identity evidence", () => {
      const result = deriveComplianceStatus(makeInput());
      expect(complianceOnchainTier(result)).toBe(0);
    });

    it("returns 0 for humanity-only users (humanity does not contribute on-chain)", () => {
      const result = deriveComplianceStatus(
        makeInput({ hasHumanityCredential: true })
      );
      expect(complianceOnchainTier(result)).toBe(0);
    });
  });
});
