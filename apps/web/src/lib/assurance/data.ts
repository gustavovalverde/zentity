/**
 * Assurance Data Access Layer
 *
 * Queries the database to gather all data needed to compute assurance state.
 * Uses React.cache() for per-request deduplication in server components.
 */
import "server-only";

import type { Session } from "@/lib/auth/auth";
import type { AssuranceState } from "./types";

import { desc, eq } from "drizzle-orm";
import { cache } from "react";

import { db } from "@/lib/db/connection";
import { getBlockchainAttestationsByUserId } from "@/lib/db/queries/attestation";
import {
  getEncryptedAttributeTypesByUserId,
  getLatestSignedClaimByUserTypeAndVerification,
  getSignedClaimTypesByUserAndVerification,
  getZkProofTypesByUserAndVerification,
} from "@/lib/db/queries/crypto";
import {
  getIdentityBundleByUserId,
  getSelectedVerification,
  isChipVerified,
} from "@/lib/db/queries/identity";
import { hasPasskeyCredentials } from "@/lib/db/queries/passkey";
import { sessions } from "@/lib/db/schema/auth";

import {
  areZkProofsComplete,
  computeAssuranceState,
  isFheComplete,
} from "./compute";

/**
 * Check if user has any confirmed on-chain attestation
 */
async function hasOnChainAttestation(userId: string): Promise<boolean> {
  const attestations = await getBlockchainAttestationsByUserId(userId);
  return attestations.some((a) => a.status === "confirmed");
}

/**
 * Check if user has secured FHE keys
 *
 * Keys are considered secured when:
 * 1. Identity bundle exists
 * 2. FHE key ID is set (key has been generated)
 *
 * Note: We check for fheKeyId rather than fheStatus === "complete"
 * because key verification happens asynchronously and a newly signed-up
 * user may have status "pending" while keys are being verified.
 */
async function hasSecuredFheKeys(userId: string): Promise<boolean> {
  const bundle = await getIdentityBundleByUserId(userId);
  return bundle?.fheKeyId !== undefined && bundle.fheKeyId !== null;
}

/**
 * OCR claim data structure with claim hashes
 */
interface OcrClaimData {
  claimHashes?: {
    age?: string | null;
    docValidity?: string | null;
    nationality?: string | null;
  };
}

/**
 * Check if OCR claim has valid claim hashes
 *
 * Returns false when document was processed but claim hashes failed to compute
 * (e.g., due to Barretenberg initialization issues in containers).
 * This indicates the document needs to be re-processed.
 */
async function hasValidClaimHashes(
  userId: string,
  verificationId: string | null
): Promise<boolean> {
  if (!verificationId) {
    return true; // No verification = no missing hashes
  }

  const ocrClaim = await getLatestSignedClaimByUserTypeAndVerification(
    userId,
    "ocr_result",
    verificationId
  );

  if (!ocrClaim) {
    return true; // No OCR claim = will be created during processing
  }

  try {
    const payload = JSON.parse(ocrClaim.claimPayload) as OcrClaimData;
    const hashes = payload.claimHashes;

    // Check if any of the required claim hashes are missing
    return !!(hashes?.age && hashes?.docValidity && hashes?.nationality);
  } catch {
    return false; // Invalid payload = needs reprocessing
  }
}

/**
 * Gather verification data from DB for assurance computation.
 * Shared between session-based and OAuth token endpoint contexts.
 */
async function gatherVerificationData(
  userId: string,
  storedLoginMethod: string | null
) {
  const [
    hasSecuredKeys,
    verification,
    fheAttributeTypes,
    hasAttestation,
    hasPasskeys,
  ] = await Promise.all([
    hasSecuredFheKeys(userId),
    getSelectedVerification(userId),
    getEncryptedAttributeTypesByUserId(userId),
    hasOnChainAttestation(userId),
    storedLoginMethod ? Promise.resolve(false) : hasPasskeyCredentials(userId),
  ]);

  const lastLoginMethod = storedLoginMethod ?? (hasPasskeys ? "passkey" : null);
  const verificationId = verification?.id ?? null;
  const documentVerified = verification?.status === "verified";
  const chipVerified = isChipVerified(verification);

  const [zkProofTypes, signedClaimTypes, claimHashesValid] = verificationId
    ? await Promise.all([
        getZkProofTypesByUserAndVerification(userId, verificationId),
        getSignedClaimTypesByUserAndVerification(userId, verificationId),
        hasValidClaimHashes(userId, verificationId),
      ])
    : [[], [], true];

  const livenessVerified = signedClaimTypes.includes("liveness_score");
  const faceMatchVerified =
    signedClaimTypes.includes("face_match_score") ||
    zkProofTypes.includes("face_match");
  const needsDocumentReprocessing = documentVerified && !claimHashesValid;

  return {
    lastLoginMethod,
    hasSecuredKeys,
    chipVerified,
    documentVerified,
    livenessVerified,
    faceMatchVerified,
    zkProofsComplete: areZkProofsComplete(zkProofTypes),
    fheComplete: isFheComplete(fheAttributeTypes),
    onChainAttested: hasAttestation,
    needsDocumentReprocessing,
  };
}

/**
 * Get the complete assurance state for a user
 *
 * Gathers data from multiple tables:
 * - Session: auth state, login method
 * - identity_bundles: FHE key status
 * - identity_verifications: document verification status
 * - signed_claims: liveness and face match claims
 * - zk_proofs: proof completion
 * - encrypted_attributes: FHE encryption status
 * - blockchain_attestations: on-chain attestation status
 */
export const getAssuranceState = cache(async function getAssuranceState(
  userId: string,
  session: Session | null
): Promise<AssuranceState> {
  const hasSession = !!session;
  const storedLoginMethod =
    (session?.session as { lastLoginMethod?: string } | undefined)
      ?.lastLoginMethod ?? null;

  const data = await gatherVerificationData(userId, storedLoginMethod);

  return computeAssuranceState({
    hasSession,
    loginMethod: data.lastLoginMethod,
    ...data,
  });
});

/**
 * Get assurance state for the OAuth token endpoint.
 *
 * Unlike getAssuranceState, this doesn't require a Session object.
 * Used in customIdTokenClaims where only { user, scopes } are available.
 * Queries the latest session for lastLoginMethod directly.
 */
export async function getAssuranceForOAuth(
  userId: string
): Promise<AssuranceState & { authTime: number }> {
  const latestSession = await db
    .select({
      lastLoginMethod: sessions.lastLoginMethod,
      createdAt: sessions.createdAt,
    })
    .from(sessions)
    .where(eq(sessions.userId, userId))
    .orderBy(desc(sessions.createdAt))
    .limit(1)
    .get();

  const storedLoginMethod = latestSession?.lastLoginMethod ?? null;
  const data = await gatherVerificationData(userId, storedLoginMethod);

  const authTime = latestSession?.createdAt
    ? Math.floor(new Date(latestSession.createdAt).getTime() / 1000)
    : Math.floor(Date.now() / 1000);

  return {
    ...computeAssuranceState({
      hasSession: true,
      loginMethod: data.lastLoginMethod,
      ...data,
    }),
    authTime,
  };
}

/**
 * Get assurance state for unauthenticated users (Tier 0)
 */
export function getUnauthenticatedAssuranceState(): AssuranceState {
  return computeAssuranceState({
    hasSession: false,
    loginMethod: null,
    hasSecuredKeys: false,
    chipVerified: false,
    documentVerified: false,
    livenessVerified: false,
    faceMatchVerified: false,
    zkProofsComplete: false,
    fheComplete: false,
    onChainAttested: false,
    needsDocumentReprocessing: false,
  });
}
