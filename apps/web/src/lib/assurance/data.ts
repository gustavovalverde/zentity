/**
 * Assurance Data Access Layer
 *
 * Queries the database to gather all data needed to compute assurance levels.
 * Uses React.cache() for per-request deduplication in server components.
 */
import "server-only";

import type { Session } from "@/lib/auth/auth";
import type { AssuranceProfile, TierProfile } from "./types";

import { cache } from "react";

import { getBlockchainAttestationsByUserId } from "@/lib/db/queries/attestation";
import {
  getEncryptedAttributeTypesByUserId,
  getSignedClaimTypesByUserAndDocument,
  getZkProofTypesByUserAndDocument,
} from "@/lib/db/queries/crypto";
import {
  getSelectedIdentityDocumentByUserId,
  getVerificationStatus,
} from "@/lib/db/queries/identity";

import {
  computeAuthAssurance,
  computeIdentityAssurance,
  computeProofAssurance,
} from "./compute";
import { buildTierProfile } from "./tier";

/**
 * Check if user has any confirmed on-chain attestation
 */
async function hasOnChainAttestation(userId: string): Promise<boolean> {
  const attestations = await getBlockchainAttestationsByUserId(userId);
  return attestations.some((a) => a.status === "confirmed");
}

/**
 * Get the complete assurance profile for a user
 *
 * Gathers data from multiple tables:
 * - Session: auth state, login method
 * - identity_documents: document verification status
 * - signed_claims: liveness and face match claims
 * - zk_proofs: proof completion
 * - encrypted_attributes: FHE encryption status
 * - attestation_evidence: on-chain attestation (future)
 */
export const getAssuranceProfile = cache(async function getAssuranceProfile(
  userId: string,
  session: Session | null
): Promise<AssuranceProfile> {
  // Get selected document for this user
  const selectedDocument = await getSelectedIdentityDocumentByUserId(userId);
  const documentId = selectedDocument?.id ?? null;

  // Gather all data in parallel
  const [verificationStatus, fheAttributeTypes, hasAttestation] =
    await Promise.all([
      getVerificationStatus(userId),
      getEncryptedAttributeTypesByUserId(userId),
      hasOnChainAttestation(userId),
    ]);

  // Get proof types if we have a document
  const [zkProofTypes, signedClaimTypes] = documentId
    ? await Promise.all([
        getZkProofTypesByUserAndDocument(userId, documentId),
        getSignedClaimTypesByUserAndDocument(userId, documentId),
      ])
    : [[], []];

  // Build auth assurance from session
  const hasSession = !!session;
  const isAnonymous = session?.user?.isAnonymous ?? false;
  const lastLoginMethod =
    (session?.session as { lastLoginMethod?: string } | undefined)
      ?.lastLoginMethod ?? null;
  const has2FA = session?.user?.twoFactorEnabled ?? false;

  const auth = computeAuthAssurance(
    hasSession,
    lastLoginMethod,
    isAnonymous,
    has2FA
  );

  // Build identity assurance from verification checks
  const identity = computeIdentityAssurance({
    documentVerified: verificationStatus.checks.document,
    livenessPassed: verificationStatus.checks.liveness,
    faceMatchPassed: verificationStatus.checks.faceMatchProof,
  });

  // Build proof assurance from cryptographic evidence
  const proof = computeProofAssurance({
    signedClaimTypes,
    zkProofTypes,
    fheAttributeTypes,
    onChainAttested: hasAttestation,
  });

  return { auth, identity, proof };
});

/**
 * Get the complete tier profile for a user
 *
 * Convenience function that combines assurance profile with tier computation.
 */
export const getTierProfile = cache(async function getTierProfile(
  userId: string,
  session: Session | null
): Promise<TierProfile> {
  const assurance = await getAssuranceProfile(userId, session);
  return buildTierProfile(assurance);
});

/**
 * Get tier profile for unauthenticated users (Tier 0)
 */
export function getUnauthenticatedTierProfile(): TierProfile {
  const assurance: AssuranceProfile = {
    auth: {
      level: 0,
      method: "none",
      isAnonymous: false,
      has2FA: false,
    },
    identity: {
      level: 0,
      documentVerified: false,
      livenessPassed: false,
      faceMatchPassed: false,
    },
    proof: {
      level: 0,
      signedClaims: false,
      zkProofsComplete: false,
      fheComplete: false,
      onChainAttested: false,
    },
  };
  return buildTierProfile(assurance);
}
