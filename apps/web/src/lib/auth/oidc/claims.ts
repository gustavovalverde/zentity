import type { ComplianceLevel } from "@/lib/identity/verification/compliance";

import { NATIONALITY_GROUP } from "@/lib/blockchain/attestation/policy";
import { getUnifiedVerificationModel } from "@/lib/identity/verification/unified-model";

export const PROOF_DISCLOSURE_KEYS = [
  "verification_level",
  "verified",
  "document_verified",
  "liveness_verified",
  "age_verification",
  "face_match_verified",
  "nationality_verified",
  "nationality_group",
  "identity_bound",
  "sybil_resistant",
  "policy_version",
  "verification_time",
  "attestation_expires_at",
  "chip_verified",
  "chip_verification_method",
] as const;

interface VerificationClaims extends Record<string, unknown> {
  age_verification: boolean;
  attestation_expires_at?: string | undefined;
  chip_verification_method?: "nfc" | undefined;
  chip_verified: boolean;
  document_verified: boolean;
  face_match_verified: boolean;
  identity_bound: boolean;
  liveness_verified: boolean;
  nationality_group?: string | undefined;
  nationality_verified: boolean;
  policy_version?: string | undefined;
  sybil_resistant: boolean;
  verification_level: ComplianceLevel;
  verification_time?: string | undefined;
  verified: boolean;
}

function mapComplianceToClaims(compliance: {
  level: ComplianceLevel;
  verified: boolean;
  checks: {
    documentVerified: boolean;
    livenessVerified: boolean;
    ageVerified: boolean;
    faceMatchVerified: boolean;
    nationalityVerified: boolean;
    identityBound: boolean;
    sybilResistant: boolean;
  };
}): VerificationClaims {
  const isChip = compliance.level === "chip";
  return {
    verification_level: compliance.level,
    verified: compliance.verified,
    document_verified: compliance.checks.documentVerified,
    liveness_verified: compliance.checks.livenessVerified,
    age_verification: compliance.checks.ageVerified,
    face_match_verified: compliance.checks.faceMatchVerified,
    nationality_verified: compliance.checks.nationalityVerified,
    nationality_group: compliance.checks.nationalityVerified
      ? NATIONALITY_GROUP
      : undefined,
    identity_bound: compliance.checks.identityBound,
    sybil_resistant: compliance.checks.sybilResistant,
    chip_verified: isChip,
    chip_verification_method: isChip ? "nfc" : undefined,
  };
}

export async function buildProofClaims(
  userId: string
): Promise<Record<string, unknown>> {
  const model = await getUnifiedVerificationModel(userId);

  const claims: VerificationClaims = mapComplianceToClaims(model.compliance);
  if (model.bundle.policyVersion) {
    claims.policy_version = model.bundle.policyVersion;
  }
  const verificationTime = model.verifiedAt ?? model.bundle.updatedAt ?? null;
  if (verificationTime) {
    claims.verification_time = verificationTime;
  }
  if (model.bundle.attestationExpiresAt) {
    claims.attestation_expires_at = model.bundle.attestationExpiresAt;
  }

  return claims;
}

export async function buildOidcVerifiedClaims(userId: string): Promise<{
  verification: Record<string, unknown>;
  claims: Record<string, unknown>;
} | null> {
  const model = await getUnifiedVerificationModel(userId);

  if (!model.compliance.verified) {
    return null;
  }

  const verification: Record<string, unknown> = {
    trust_framework: "eidas",
    assurance_level: model.compliance.level,
  };
  const verificationTime = model.verifiedAt ?? model.bundle.updatedAt ?? null;
  if (verificationTime) {
    verification.time = verificationTime;
  }
  if (model.bundle.policyVersion) {
    verification.policy_version = model.bundle.policyVersion;
  }
  if (model.bundle.attestationExpiresAt) {
    verification.attestation_expires_at = model.bundle.attestationExpiresAt;
  }

  return {
    verification,
    claims: mapComplianceToClaims(model.compliance),
  };
}
