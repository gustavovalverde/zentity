import type { IdentityFields } from "@/lib/privacy/server-encryption/identity";

import {
  getIdentityBundleByUserId,
  getLatestIdentityDocumentByUserId,
  getVerificationStatus,
} from "@/lib/db/queries/identity";
import { getOAuthIdentityData } from "@/lib/db/queries/oauth-identity";
import { decryptIdentityFromServer } from "@/lib/privacy/server-encryption/identity";

import { filterIdentityByScopes } from "./identity-scopes";

export const VC_DISCLOSURE_KEYS = [
  "verification_level",
  "verified",
  "document_verified",
  "liveness_verified",
  "age_proof_verified",
  "doc_validity_proof_verified",
  "nationality_proof_verified",
  "face_match_verified",
  "policy_version",
  "issuer_id",
  "verification_time",
  "attestation_expires_at",
] as const;

type VerificationStatus = Awaited<ReturnType<typeof getVerificationStatus>>;

interface VerificationClaims extends Record<string, unknown> {
  verification_level: VerificationStatus["level"];
  verified: boolean;
  document_verified: boolean;
  liveness_verified: boolean;
  age_proof_verified: boolean;
  doc_validity_proof_verified: boolean;
  nationality_proof_verified: boolean;
  face_match_verified: boolean;
  policy_version?: string;
  issuer_id?: string;
  verification_time?: string;
  attestation_expires_at?: string;
}

function mapVerificationClaims(status: VerificationStatus): VerificationClaims {
  return {
    verification_level: status.level,
    verified: status.verified,
    document_verified: status.checks.document,
    liveness_verified: status.checks.liveness,
    age_proof_verified: status.checks.ageProof,
    doc_validity_proof_verified: status.checks.docValidityProof,
    nationality_proof_verified: status.checks.nationalityProof,
    face_match_verified: status.checks.faceMatchProof,
  };
}

export async function buildVcClaims(
  userId: string
): Promise<Record<string, unknown>> {
  const [status, bundle, document] = await Promise.all([
    getVerificationStatus(userId),
    getIdentityBundleByUserId(userId),
    getLatestIdentityDocumentByUserId(userId),
  ]);

  const claims: VerificationClaims = mapVerificationClaims(status);
  if (bundle?.policyVersion) {
    claims.policy_version = bundle.policyVersion;
  }
  if (bundle?.issuerId) {
    claims.issuer_id = bundle.issuerId;
  }
  const verificationTime = document?.verifiedAt ?? bundle?.updatedAt ?? null;
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
  const [status, bundle, document] = await Promise.all([
    getVerificationStatus(userId),
    getIdentityBundleByUserId(userId),
    getLatestIdentityDocumentByUserId(userId),
  ]);

  if (status.level === "none") {
    return null;
  }

  const verification: Record<string, unknown> = {
    trust_framework: "zentity",
    assurance_level: status.level,
  };
  const verificationTime = document?.verifiedAt ?? bundle?.updatedAt ?? null;
  if (verificationTime) {
    verification.time = verificationTime;
  }
  if (bundle?.policyVersion) {
    verification.policy_version = bundle.policyVersion;
  }
  if (bundle?.issuerId) {
    verification.issuer_id = bundle.issuerId;
  }
  if (bundle?.attestationExpiresAt) {
    verification.attestation_expires_at = bundle.attestationExpiresAt;
  }

  return {
    verification,
    claims: mapVerificationClaims(status),
  };
}

/**
 * Build identity claims for OAuth userinfo responses.
 *
 * Identity data is stored server-encrypted per RP relationship.
 * This function decrypts and filters based on consented scopes.
 *
 * @param userId - The user's ID
 * @param clientId - The OAuth client (RP) ID
 * @returns Identity claims filtered by consented scopes, or null if no data
 */
export async function buildIdentityClaims(
  userId: string,
  clientId: string
): Promise<Partial<IdentityFields> | null> {
  const identityData = await getOAuthIdentityData(userId, clientId);
  if (!identityData) {
    return null;
  }

  // Decrypt the stored identity blob
  const identity = await decryptIdentityFromServer(identityData.encryptedBlob, {
    userId,
    clientId,
  });

  // Filter to only include fields allowed by consented scopes
  const filteredIdentity = filterIdentityByScopes(
    identity,
    identityData.consentedScopes
  );

  // Return null if no fields remain after filtering
  if (Object.keys(filteredIdentity).length === 0) {
    return null;
  }

  return filteredIdentity;
}
