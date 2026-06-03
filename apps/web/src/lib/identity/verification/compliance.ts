/**
 * Compliance derivation engine.
 *
 * Pure function that projects evidence (ZK proofs, signed claims, document
 * commitments, humanity credentials) onto three orthogonal axes:
 *
 *   1. `identity` — was the user's real-world identity proven, and how strongly?
 *   2. `humanity` — has any external uniqueness provider attested they are unique?
 *   3. `policy`  — the canonical 7-boolean check set with policy versioning.
 *
 * No DB, tRPC, or env imports — this is the sole source of truth for
 * compliance and remains a pure function. Persist results via the
 * materialization engine (`materialize.ts`); read them via the read model
 * (`read-model.ts`).
 *
 * On-chain encoders (confidential mirror, EIP-712 permit) consume `complianceOnchainTier`,
 * which produces a `uint8` derived solely from `identity.strength`. Humanity
 * does NOT contribute to the on-chain numeric tier — it is its own surface.
 */

import { ISO_3166_ALPHA3_TO_NUMERIC } from "./iso-3166-numeric";

// ─── Orthogonal axes ────────────────────────────────────────────────

export type VerificationMethod = "ocr" | "nfc_chip" | null;

/**
 * Identity-evidence strength. Ordered from weakest to strongest as a
 * uint8 ladder for on-chain encoding (see `COMPLIANCE_ONCHAIN_TIERS`).
 *   - `none`               — no document or chip evidence
 *   - `documentary`        — OCR document parse only (basic)
 *   - `documentary_full`   — OCR + liveness + face-match + ZK proofs
 *   - `cryptographic_chip` — NFC chip read with strong cryptographic binding
 */
export type IdentityEvidenceStrength =
  | "none"
  | "documentary"
  | "documentary_full"
  | "cryptographic_chip";

export interface ComplianceChecks {
  ageVerified: boolean;
  documentVerified: boolean;
  faceMatchVerified: boolean;
  identityBound: boolean;
  livenessVerified: boolean;
  nationalityVerified: boolean;
  sybilResistant: boolean;
}

export interface IdentityAxis {
  /** Which verification path produced the evidence, or null if absent. */
  method: VerificationMethod;
  /** Discrete evidence-strength tier, mappable to uint8 for on-chain. */
  strength: IdentityEvidenceStrength;
  /** True iff every required check passes for the active verification path. */
  verified: boolean;
}

export interface HumanityAxis {
  /** True iff the user has at least one active humanity credential. */
  proven: boolean;
}

export interface PolicyAxis {
  /** Birth-year offset (0-255) for confidential-chain age encoding. */
  birthYearOffset: number | null;
  /** The seven canonical compliance checks. */
  checks: ComplianceChecks;
  /** Policy version under which checks were materialized. */
  version: string;
}

export interface ComplianceResult {
  humanity: HumanityAxis;
  identity: IdentityAxis;
  policy: PolicyAxis;
}

// ─── Input ──────────────────────────────────────────────────────────

interface ComplianceInput {
  birthYearOffset: number | null;
  hasDocumentSybilSignal: boolean;
  hasHumanityCredential: boolean;
  hasNationalityCommitment: boolean;
  policyVersion?: string;
  signedClaims: ReadonlyArray<{ claimType: string }>;
  verificationMethod: VerificationMethod;
  zkProofs: ReadonlyArray<{ proofType: string; verified: boolean }>;
}

// ─── Constants ──────────────────────────────────────────────────────

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

/**
 * On-chain `uint8` tier derived from `identity.strength` only.
 * Humanity is exposed via separate scopes; never aggregated into this number.
 */
export const COMPLIANCE_ONCHAIN_TIERS = {
  none: 0,
  documentary: 1,
  documentary_full: 2,
  cryptographic_chip: 3,
} as const;

export const DEFAULT_POLICY_VERSION = "v1.0";

// ─── Derivation engine ─────────────────────────────────────────────

export function deriveComplianceStatus(
  input: ComplianceInput
): ComplianceResult {
  const checks = deriveChecksForMethod(input);
  const verified =
    input.verificationMethod !== null && Object.values(checks).every(Boolean);
  const strength = deriveIdentityStrength(checks, input.verificationMethod);

  return {
    identity: {
      verified,
      method: input.verificationMethod,
      strength,
    },
    humanity: {
      proven: input.hasHumanityCredential,
    },
    policy: {
      version: input.policyVersion ?? DEFAULT_POLICY_VERSION,
      checks,
      birthYearOffset: validateBirthYearOffset(input.birthYearOffset),
    },
  };
}

export function complianceOnchainTier(compliance: ComplianceResult): number {
  return COMPLIANCE_ONCHAIN_TIERS[compliance.identity.strength];
}

// ─── Method-specific check derivation ──────────────────────────────

function deriveChecksForMethod(input: ComplianceInput): ComplianceChecks {
  if (!input.verificationMethod) {
    return {
      ...EMPTY_CHECKS,
      sybilResistant:
        input.hasDocumentSybilSignal || input.hasHumanityCredential,
    };
  }
  if (input.verificationMethod === "nfc_chip") {
    return deriveNfcChecks(input);
  }
  return deriveOcrChecks(input);
}

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
    sybilResistant: input.hasDocumentSybilSignal || input.hasHumanityCredential,
  };
}

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
    sybilResistant: input.hasDocumentSybilSignal || input.hasHumanityCredential,
  };
}

// ─── Identity strength ──────────────────────────────────────────────

function deriveIdentityStrength(
  checks: ComplianceChecks,
  method: VerificationMethod
): IdentityEvidenceStrength {
  if (method === "nfc_chip" && checks.documentVerified) {
    return "cryptographic_chip";
  }
  if (method === "ocr") {
    const corePassed =
      checks.documentVerified &&
      checks.livenessVerified &&
      checks.faceMatchVerified &&
      checks.ageVerified;
    if (corePassed) {
      return "documentary_full";
    }
    if (checks.documentVerified) {
      return "documentary";
    }
  }
  return "none";
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

/**
 * Map ISO 3166-1 alpha-3 country code to numeric code.
 * Uses the complete ISO 3166-1 standard (249 entries).
 */
export function countryCodeToNumeric(alphaCode: string): number {
  return ISO_3166_ALPHA3_TO_NUMERIC[alphaCode.toUpperCase()] ?? 0;
}
