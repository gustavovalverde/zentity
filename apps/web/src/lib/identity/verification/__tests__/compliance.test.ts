import { describe, expect, it } from "vitest";

import { deriveComplianceStatus } from "../compliance";

type ComplianceInput = Parameters<typeof deriveComplianceStatus>[0];

function makeInput(overrides: Partial<ComplianceInput> = {}): ComplianceInput {
  return {
    verificationMethod: null,
    birthYearOffset: null,
    zkProofs: [],
    signedClaims: [],
    encryptedAttributes: [],
    hasUniqueIdentifier: false,
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
    it("returns none when verificationMethod is null", () => {
      const result = deriveComplianceStatus(makeInput());
      expect(result.level).toBe("none");
      expect(result.numericLevel).toBe(1);
      expect(result.verified).toBe(false);
      expect(Object.values(result.checks).every((v) => v === false)).toBe(true);
    });
  });

  describe("birthYearOffset validation", () => {
    it("passes through valid offset", () => {
      const result = deriveComplianceStatus(makeInput({ birthYearOffset: 25 }));
      expect(result.birthYearOffset).toBe(25);
    });

    it("passes through 0 (minimum)", () => {
      const result = deriveComplianceStatus(makeInput({ birthYearOffset: 0 }));
      expect(result.birthYearOffset).toBe(0);
    });

    it("passes through 255 (maximum)", () => {
      const result = deriveComplianceStatus(
        makeInput({ birthYearOffset: 255 })
      );
      expect(result.birthYearOffset).toBe(255);
    });

    it("returns null for negative offset", () => {
      const result = deriveComplianceStatus(makeInput({ birthYearOffset: -1 }));
      expect(result.birthYearOffset).toBeNull();
    });

    it("returns null for offset > 255", () => {
      const result = deriveComplianceStatus(
        makeInput({ birthYearOffset: 256 })
      );
      expect(result.birthYearOffset).toBeNull();
    });

    it("returns null for non-integer", () => {
      const result = deriveComplianceStatus(
        makeInput({ birthYearOffset: 25.5 })
      );
      expect(result.birthYearOffset).toBeNull();
    });

    it("returns null for null input", () => {
      const result = deriveComplianceStatus(
        makeInput({ birthYearOffset: null })
      );
      expect(result.birthYearOffset).toBeNull();
    });
  });

  describe("OCR path", () => {
    it("returns none with 0 verified proofs", () => {
      const result = deriveComplianceStatus(
        makeInput({ verificationMethod: "ocr" })
      );
      expect(result.level).toBe("none");
      expect(result.numericLevel).toBe(1);
      expect(result.verified).toBe(false);
    });

    it("returns basic when 4+ checks pass", () => {
      const result = deriveComplianceStatus(
        makeInput({
          verificationMethod: "ocr",
          zkProofs: [
            { proofType: "age_verification", verified: true },
            { proofType: "doc_validity", verified: true },
            { proofType: "face_match", verified: true },
            { proofType: "identity_binding", verified: true },
          ],
        })
      );
      expect(result.level).toBe("basic");
      expect(result.numericLevel).toBe(2);
      expect(result.verified).toBe(false);
      expect(result.checks.ageVerified).toBe(true);
      expect(result.checks.documentVerified).toBe(true);
      expect(result.checks.faceMatchVerified).toBe(true);
      expect(result.checks.identityBound).toBe(true);
    });

    it("returns full when all 7 checks pass", () => {
      const result = deriveComplianceStatus(
        makeInput({
          verificationMethod: "ocr",
          zkProofs: ALL_OCR_PROOFS,
          signedClaims: ALL_OCR_CLAIMS,
          hasUniqueIdentifier: true,
        })
      );
      expect(result.level).toBe("full");
      expect(result.numericLevel).toBe(3);
      expect(result.verified).toBe(true);
      expect(result.checks.documentVerified).toBe(true);
      expect(result.checks.livenessVerified).toBe(true);
      expect(result.checks.ageVerified).toBe(true);
      expect(result.checks.faceMatchVerified).toBe(true);
      expect(result.checks.nationalityVerified).toBe(true);
      expect(result.checks.identityBound).toBe(true);
      expect(result.checks.sybilResistant).toBe(true);
    });

    it("ignores unverified proofs", () => {
      const result = deriveComplianceStatus(
        makeInput({
          verificationMethod: "ocr",
          zkProofs: [
            { proofType: "age_verification", verified: false },
            { proofType: "doc_validity", verified: true },
          ],
        })
      );
      expect(result.checks.ageVerified).toBe(false);
      expect(result.checks.documentVerified).toBe(true);
    });

    it("face_match_score claim satisfies faceMatchVerified", () => {
      const result = deriveComplianceStatus(
        makeInput({
          verificationMethod: "ocr",
          signedClaims: [{ claimType: "face_match_score" }],
        })
      );
      expect(result.checks.faceMatchVerified).toBe(true);
    });

    it("sybilResistant requires hasUniqueIdentifier", () => {
      const result = deriveComplianceStatus(
        makeInput({
          verificationMethod: "ocr",
          zkProofs: ALL_OCR_PROOFS,
          signedClaims: ALL_OCR_CLAIMS,
          hasUniqueIdentifier: false,
        })
      );
      expect(result.checks.sybilResistant).toBe(false);
      expect(result.level).toBe("basic");
    });
  });

  describe("NFC chip path", () => {
    it("returns chip when hasUniqueIdentifier is true", () => {
      const result = deriveComplianceStatus(
        makeInput({
          verificationMethod: "nfc_chip",
          signedClaims: [{ claimType: "chip_verification" }],
          hasUniqueIdentifier: true,
          hasNationalityCommitment: true,
        })
      );
      expect(result.level).toBe("chip");
      expect(result.numericLevel).toBe(4);
      expect(result.verified).toBe(true);
      expect(result.checks.documentVerified).toBe(true);
      expect(result.checks.livenessVerified).toBe(true);
      expect(result.checks.ageVerified).toBe(true);
      expect(result.checks.faceMatchVerified).toBe(true);
      expect(result.checks.nationalityVerified).toBe(true);
      expect(result.checks.identityBound).toBe(true);
      expect(result.checks.sybilResistant).toBe(true);
    });

    it("derives checks from claim type presence, not boolean payloads", () => {
      const result = deriveComplianceStatus(
        makeInput({
          verificationMethod: "nfc_chip",
          signedClaims: [{ claimType: "chip_verification" }],
          hasUniqueIdentifier: true,
          hasNationalityCommitment: false,
        })
      );
      expect(result.checks.ageVerified).toBe(true);
      expect(result.checks.faceMatchVerified).toBe(true);
      expect(result.checks.livenessVerified).toBe(true);
      expect(result.checks.nationalityVerified).toBe(false);
    });

    it("returns chip even without signed claim if hasUniqueIdentifier is true", () => {
      const result = deriveComplianceStatus(
        makeInput({
          verificationMethod: "nfc_chip",
          signedClaims: [],
          hasUniqueIdentifier: true,
        })
      );
      expect(result.level).toBe("chip");
      expect(result.checks.livenessVerified).toBe(false);
      expect(result.checks.ageVerified).toBe(false);
      expect(result.checks.faceMatchVerified).toBe(false);
    });

    it("falls through to regular levels when hasUniqueIdentifier is false", () => {
      const result = deriveComplianceStatus(
        makeInput({
          verificationMethod: "nfc_chip",
          signedClaims: [{ claimType: "chip_verification" }],
          hasUniqueIdentifier: false,
          hasNationalityCommitment: true,
        })
      );
      expect(result.level).toBe("basic");
      expect(result.checks.sybilResistant).toBe(false);
    });

    it("documentVerified is always true for NFC", () => {
      const result = deriveComplianceStatus(
        makeInput({
          verificationMethod: "nfc_chip",
          signedClaims: [],
          hasUniqueIdentifier: false,
        })
      );
      expect(result.checks.documentVerified).toBe(true);
    });
  });

  describe("level transitions", () => {
    it("none → basic at 4 checks", () => {
      const threeChecks = deriveComplianceStatus(
        makeInput({
          verificationMethod: "ocr",
          zkProofs: [
            { proofType: "age_verification", verified: true },
            { proofType: "doc_validity", verified: true },
            { proofType: "face_match", verified: true },
          ],
        })
      );
      expect(threeChecks.level).toBe("none");

      const fourChecks = deriveComplianceStatus(
        makeInput({
          verificationMethod: "ocr",
          zkProofs: [
            { proofType: "age_verification", verified: true },
            { proofType: "doc_validity", verified: true },
            { proofType: "face_match", verified: true },
            { proofType: "identity_binding", verified: true },
          ],
        })
      );
      expect(fourChecks.level).toBe("basic");
    });

    it("basic → full at 7 checks", () => {
      const sixChecks = deriveComplianceStatus(
        makeInput({
          verificationMethod: "ocr",
          zkProofs: ALL_OCR_PROOFS,
          signedClaims: ALL_OCR_CLAIMS,
          hasUniqueIdentifier: false,
        })
      );
      expect(sixChecks.level).toBe("basic");

      const sevenChecks = deriveComplianceStatus(
        makeInput({
          verificationMethod: "ocr",
          zkProofs: ALL_OCR_PROOFS,
          signedClaims: ALL_OCR_CLAIMS,
          hasUniqueIdentifier: true,
        })
      );
      expect(sevenChecks.level).toBe("full");
    });
  });

  describe("edge cases", () => {
    it("empty proofs array with OCR method", () => {
      const result = deriveComplianceStatus(
        makeInput({
          verificationMethod: "ocr",
          zkProofs: [],
          signedClaims: [],
        })
      );
      expect(result.level).toBe("none");
      expect(result.verified).toBe(false);
    });

    it("encryptedAttributes are accepted but do not affect derivation", () => {
      const result = deriveComplianceStatus(
        makeInput({
          verificationMethod: "ocr",
          encryptedAttributes: [
            { attributeType: "dob_days" },
            { attributeType: "liveness_score" },
          ],
        })
      );
      expect(result.level).toBe("none");
    });
  });
});
