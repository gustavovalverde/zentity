/**
 * Compliance derivation engine.
 *
 * Pure function that derives compliance status from proofs, claims, and flags.
 * No DB, tRPC, or env imports — this is the sole source of truth for compliance.
 */

// ─── Input / Output types ───────────────────────────────────────────

interface ComplianceInput {
  birthYearOffset: number | null;
  hasDocumentSybilSignal: boolean;
  hasHumanUniquenessSignal: boolean;
  hasNationalityCommitment: boolean;
  signedClaims: ReadonlyArray<{ claimType: string }>;
  verificationMethod: "ocr" | "nfc_chip" | null;
  zkProofs: ReadonlyArray<{ proofType: string; verified: boolean }>;
}

export interface ComplianceChecks {
  ageVerified: boolean;
  documentVerified: boolean;
  faceMatchVerified: boolean;
  identityBound: boolean;
  livenessVerified: boolean;
  nationalityVerified: boolean;
  sybilResistant: boolean;
}

export type ComplianceLevel =
  | "none"
  | "human_verified"
  | "basic"
  | "full"
  | "chip";

export interface ComplianceResult {
  birthYearOffset: number | null;
  checks: ComplianceChecks;
  level: ComplianceLevel;
  numericLevel: number;
  verified: boolean;
}

// ─── Constants ──────────────────────────────────────────────────────

const COMPLIANCE_LEVEL_NUMERIC: Record<ComplianceLevel, number> = {
  chip: 4,
  full: 3,
  basic: 2,
  human_verified: 1.5,
  none: 1,
};

export const EMPTY_CHECKS: ComplianceChecks = {
  documentVerified: false,
  livenessVerified: false,
  ageVerified: false,
  faceMatchVerified: false,
  nationalityVerified: false,
  identityBound: false,
  sybilResistant: false,
};

export const VERIFICATION_CHECK_TYPES = [
  "document",
  "age",
  "liveness",
  "face_match",
  "nationality",
  "identity_binding",
  "sybil_resistant",
] as const;

export type VerificationCheckType = (typeof VERIFICATION_CHECK_TYPES)[number];

export const CHECK_TYPE_TO_COMPLIANCE_KEY: Record<
  VerificationCheckType,
  keyof ComplianceChecks
> = {
  document: "documentVerified",
  age: "ageVerified",
  liveness: "livenessVerified",
  face_match: "faceMatchVerified",
  nationality: "nationalityVerified",
  identity_binding: "identityBound",
  sybil_resistant: "sybilResistant",
};

// ─── Derivation engine ─────────────────────────────────────────────

export function deriveComplianceStatus(
  input: ComplianceInput
): ComplianceResult {
  const birthYearOffset = validateBirthYearOffset(input.birthYearOffset);

  if (!input.verificationMethod) {
    const checks = {
      ...EMPTY_CHECKS,
      sybilResistant: input.hasHumanUniquenessSignal,
    };
    const { level, numericLevel, verified } = deriveLevelFromChecks(
      checks,
      null
    );

    return {
      verified,
      level,
      numericLevel,
      birthYearOffset,
      checks,
    };
  }

  const checks =
    input.verificationMethod === "nfc_chip"
      ? deriveNfcChecks(input)
      : deriveOcrChecks(input);

  const { level, numericLevel, verified } = deriveLevelFromChecks(
    checks,
    input.verificationMethod
  );

  return { verified, level, numericLevel, birthYearOffset, checks };
}

export function deriveLevelFromChecks(
  checks: ComplianceChecks,
  verificationMethod: "ocr" | "nfc_chip" | null
): { level: ComplianceLevel; numericLevel: number; verified: boolean } {
  if (!verificationMethod) {
    if (checks.sybilResistant) {
      return {
        level: "human_verified",
        numericLevel: COMPLIANCE_LEVEL_NUMERIC.human_verified,
        verified: false,
      };
    }

    return {
      level: "none",
      numericLevel: COMPLIANCE_LEVEL_NUMERIC.none,
      verified: false,
    };
  }

  const passedCount = Object.values(checks).filter(Boolean).length;
  const totalCount = Object.keys(checks).length;

  let level: ComplianceLevel;
  if (verificationMethod === "nfc_chip" && checks.sybilResistant) {
    level = "chip";
  } else if (passedCount === totalCount) {
    level = "full";
  } else if (passedCount >= Math.ceil(totalCount / 2)) {
    level = "basic";
  } else if (checks.sybilResistant) {
    level = "human_verified";
  } else {
    level = "none";
  }

  return {
    level,
    numericLevel: COMPLIANCE_LEVEL_NUMERIC[level],
    verified: level === "full" || level === "chip",
  };
}

// ─── NFC chip path ──────────────────────────────────────────────────

function deriveNfcChecks(input: ComplianceInput): ComplianceChecks {
  const hasChipClaim = input.signedClaims.some(
    (c) => c.claimType === "chip_verification"
  );

  return {
    documentVerified: true,
    livenessVerified: hasChipClaim,
    ageVerified: hasChipClaim,
    faceMatchVerified: hasChipClaim,
    nationalityVerified: input.hasNationalityCommitment,
    identityBound: input.hasDocumentSybilSignal,
    sybilResistant:
      input.hasDocumentSybilSignal || input.hasHumanUniquenessSignal,
  };
}

// ─── OCR path ───────────────────────────────────────────────────────

function deriveOcrChecks(input: ComplianceInput): ComplianceChecks {
  const verifiedTypes = new Set(
    input.zkProofs.filter((p) => p.verified).map((p) => p.proofType)
  );
  const claimTypes = new Set(input.signedClaims.map((c) => c.claimType));

  return {
    documentVerified: verifiedTypes.has("doc_validity"),
    livenessVerified: claimTypes.has("liveness_score"),
    ageVerified: verifiedTypes.has("age_verification"),
    faceMatchVerified:
      verifiedTypes.has("face_match") || claimTypes.has("face_match_score"),
    nationalityVerified: verifiedTypes.has("nationality_membership"),
    identityBound: verifiedTypes.has("identity_binding"),
    sybilResistant:
      input.hasDocumentSybilSignal || input.hasHumanUniquenessSignal,
  };
}

// ─── Helpers ────────────────────────────────────────────────────────

function validateBirthYearOffset(value: number | null): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (!Number.isInteger(value) || value < 0 || value > 255) {
    return null;
  }
  return value;
}

import { ISO_3166_ALPHA3_TO_NUMERIC } from "./iso-3166-numeric";

/**
 * Map ISO 3166-1 alpha-3 country code to numeric code.
 * Uses the complete ISO 3166-1 standard (249 entries).
 */
export function countryCodeToNumeric(alphaCode: string): number {
  return ISO_3166_ALPHA3_TO_NUMERIC[alphaCode.toUpperCase()] ?? 0;
}
