/**
 * OIDC Claims: proof claims construction and the OIDC `claims` parameter.
 *
 * Two concerns, one domain:
 * - buildProofClaims / buildOidcVerifiedClaims: pull verification state into
 *   OIDC claim objects for id_token and userinfo.
 * - parseClaimsParameter / filterClaimsByRequest: parse and apply the OIDC
 *   Core `claims` request parameter to selectively disclose per endpoint.
 */
import type { ComplianceLevel } from "@/lib/identity/verification/compliance";

import { NATIONALITY_GROUP } from "@/lib/blockchain/attestation/policy";
import { getUnifiedVerificationModel } from "@/lib/identity/verification/unified-model";

// ---------------------------------------------------------------------------
// Proof claims construction
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// OIDC `claims` request parameter (OIDC Core §5.5)
// ---------------------------------------------------------------------------

/** Parsed claims request for a single endpoint (id_token or userinfo). */
export type ClaimsRequest = Record<
  string,
  null | {
    essential?: boolean;
    value?: unknown;
    values?: unknown[];
  }
>;

export interface ParsedClaimsParameter {
  id_token?: ClaimsRequest | undefined;
  userinfo?: ClaimsRequest | undefined;
}

function isClaimsRequest(v: unknown): v is ClaimsRequest {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Parse the raw `claims` JSON string from the authorization request.
 * Returns null if absent, empty, or malformed.
 */
export function parseClaimsParameter(
  raw: unknown
): ParsedClaimsParameter | null {
  if (typeof raw !== "string" || raw.length === 0) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }

    const result: ParsedClaimsParameter = {};

    if (isClaimsRequest(parsed.id_token)) {
      result.id_token = parsed.id_token;
    }
    if (isClaimsRequest(parsed.userinfo)) {
      result.userinfo = parsed.userinfo;
    }

    return Object.keys(result).length > 0 ? result : null;
  } catch {
    return null;
  }
}

/**
 * Filter a claims object to only include claims requested for a specific endpoint.
 * If no claims parameter was provided, returns the full claims object unchanged.
 */
export function filterClaimsByRequest(
  allClaims: Record<string, unknown>,
  requested: ClaimsRequest | undefined
): Record<string, unknown> {
  if (!requested) {
    return allClaims;
  }

  const filtered: Record<string, unknown> = {};

  for (const [claimName, constraint] of Object.entries(requested)) {
    if (!(claimName in allClaims)) {
      continue;
    }

    const value = allClaims[claimName];

    if (constraint === null) {
      filtered[claimName] = value;
      continue;
    }

    if (constraint.value !== undefined && value !== constraint.value) {
      continue;
    }

    if (constraint.values !== undefined && !constraint.values.includes(value)) {
      continue;
    }

    filtered[claimName] = value;
  }

  return filtered;
}
