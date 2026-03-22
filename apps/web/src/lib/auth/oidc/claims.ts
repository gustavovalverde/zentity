import { NATIONALITY_GROUP } from "@/lib/blockchain/attestation/policy";
import {
  getIdentityBundleByUserId,
  getLatestVerification,
  getVerificationStatus,
} from "@/lib/db/queries/identity";

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

type VerificationStatus = Awaited<ReturnType<typeof getVerificationStatus>>;

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
  verification_level: VerificationStatus["level"];
  verification_time?: string | undefined;
  verified: boolean;
}

function mapVerificationClaims(status: VerificationStatus): VerificationClaims {
  const isChip = status.level === "chip";
  return {
    verification_level: status.level,
    verified: status.verified,
    document_verified: status.checks.documentVerified,
    liveness_verified: status.checks.livenessVerified,
    age_verification: status.checks.ageVerified,
    face_match_verified: status.checks.faceMatchVerified,
    nationality_verified: status.checks.nationalityVerified,
    nationality_group: status.checks.nationalityVerified
      ? NATIONALITY_GROUP
      : undefined,
    identity_bound: status.checks.identityBound,
    sybil_resistant: status.checks.sybilResistant,
    chip_verified: isChip,
    chip_verification_method: isChip ? "nfc" : undefined,
  };
}

export async function buildProofClaims(
  userId: string
): Promise<Record<string, unknown>> {
  const [status, bundle, latestVerification] = await Promise.all([
    getVerificationStatus(userId),
    getIdentityBundleByUserId(userId),
    getLatestVerification(userId),
  ]);

  const claims: VerificationClaims = mapVerificationClaims(status);
  if (bundle?.policyVersion) {
    claims.policy_version = bundle.policyVersion;
  }
  const verificationTime =
    latestVerification?.verifiedAt ?? bundle?.updatedAt ?? null;
  if (verificationTime) {
    claims.verification_time = verificationTime;
  }
  if (bundle?.attestationExpiresAt) {
    claims.attestation_expires_at = bundle.attestationExpiresAt;
  }

  return claims;
}

export async function buildOidcVerifiedClaims(userId: string): Promise<{
  verification: Record<string, unknown>;
  claims: Record<string, unknown>;
} | null> {
  const [status, bundle, latestVerification] = await Promise.all([
    getVerificationStatus(userId),
    getIdentityBundleByUserId(userId),
    getLatestVerification(userId),
  ]);

  if (!status.verified) {
    return null;
  }

  const verification: Record<string, unknown> = {
    trust_framework: "eidas",
    assurance_level: status.level,
  };
  const verificationTime =
    latestVerification?.verifiedAt ?? bundle?.updatedAt ?? null;
  if (verificationTime) {
    verification.time = verificationTime;
  }
  if (bundle?.policyVersion) {
    verification.policy_version = bundle.policyVersion;
  }
  if (bundle?.attestationExpiresAt) {
    verification.attestation_expires_at = bundle.attestationExpiresAt;
  }

  return {
    verification,
    claims: mapVerificationClaims(status),
  };
}
