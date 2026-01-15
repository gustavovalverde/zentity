/**
 * Claims Signing Module
 *
 * Handles generation and signing of attestation claims.
 * Each claim type has a focused function with proper error handling.
 *
 * Claim Types:
 * - OCR Result: Document data with claim hashes
 * - Liveness Score: Anti-spoofing and liveness metrics
 * - Face Match Score: Face similarity with threshold
 */
import "server-only";

import { v4 as uuidv4 } from "uuid";

import { computeClaimHash } from "@/lib/attestation/claim-hash";
import { POLICY_VERSION } from "@/lib/attestation/policy";
import { signAttestationClaim } from "@/lib/crypto/signed-claims";
import { insertSignedClaim } from "@/lib/db/queries/crypto";
import { FACE_MATCH_MIN_CONFIDENCE } from "@/lib/liveness/policy";

import {
  ClaimSigningError,
  logVerificationError,
  safeExecute,
} from "./verification-errors";

/**
 * Claim hashes computed from document data.
 */
export interface ClaimHashes {
  age: string | null;
  docValidity: string | null;
  nationality: string | null;
}

/**
 * Input for OCR claim generation.
 */
export interface OcrClaimInput {
  userId: string;
  documentId: string | null;
  documentHash: string;
  documentHashField: string;
  documentType: string | null;
  issuerCountry: string | null;
  confidence: number | null;
  claimHashes: ClaimHashes;
}

/**
 * Input for liveness claim generation.
 */
export interface LivenessClaimInput {
  userId: string;
  documentId: string | null;
  documentHash: string | null;
  documentHashField: string | null;
  antispoofScore: number;
  liveScore: number;
  passed: boolean;
}

/**
 * Input for face match claim generation.
 */
export interface FaceMatchClaimInput {
  userId: string;
  documentId: string | null;
  documentHash: string | null;
  documentHashField: string | null;
  confidence: number;
  passed: boolean;
}

/**
 * Compute claim hashes for age, document validity, and nationality.
 * Each hash is computed independently - failures don't affect others.
 *
 * @returns Object with computed hashes (null if computation failed)
 */
export async function computeClaimHashes(params: {
  documentHashField: string;
  birthYear: number | null;
  expiryDateInt: number | null;
  nationalityCodeNumeric: number | null;
}): Promise<{ hashes: ClaimHashes; issues: string[] }> {
  const {
    documentHashField,
    birthYear,
    expiryDateInt,
    nationalityCodeNumeric,
  } = params;

  const hashes: ClaimHashes = {
    age: null,
    docValidity: null,
    nationality: null,
  };
  const issues: string[] = [];

  // Compute hashes in parallel for independent values
  const hashTasks: Promise<void>[] = [];

  if (birthYear !== null) {
    hashTasks.push(
      (async () => {
        const result = await safeExecute(
          () => computeClaimHash({ value: birthYear, documentHashField }),
          { hashType: "age", birthYear }
        );
        if (result.success) {
          hashes.age = result.value;
        } else {
          issues.push("age_claim_hash_failed");
        }
      })()
    );
  }

  if (expiryDateInt !== null) {
    hashTasks.push(
      (async () => {
        const result = await safeExecute(
          () => computeClaimHash({ value: expiryDateInt, documentHashField }),
          { hashType: "docValidity", expiryDateInt }
        );
        if (result.success) {
          hashes.docValidity = result.value;
        } else {
          issues.push("doc_validity_claim_hash_failed");
        }
      })()
    );
  }

  if (nationalityCodeNumeric !== null) {
    hashTasks.push(
      (async () => {
        const result = await safeExecute(
          () =>
            computeClaimHash({
              value: nationalityCodeNumeric,
              documentHashField,
            }),
          { hashType: "nationality", nationalityCodeNumeric }
        );
        if (result.success) {
          hashes.nationality = result.value;
        } else {
          issues.push("nationality_claim_hash_failed");
        }
      })()
    );
  }

  if (hashTasks.length > 0) {
    await Promise.all(hashTasks);
  }

  return { hashes, issues };
}

/**
 * Generate and store a signed OCR result claim.
 *
 * @returns Issue code if failed, null if successful
 */
export async function signAndStoreOcrClaim(
  input: OcrClaimInput
): Promise<string | null> {
  const issuedAt = new Date().toISOString();

  try {
    const ocrClaimPayload = {
      type: "ocr_result" as const,
      userId: input.userId,
      issuedAt,
      version: 1,
      policyVersion: POLICY_VERSION,
      documentHash: input.documentHash,
      documentHashField: input.documentHashField,
      data: {
        documentType: input.documentType,
        issuerCountry: input.issuerCountry,
        confidence: input.confidence,
        claimHashes: input.claimHashes,
      },
    };

    const signature = await signAttestationClaim(ocrClaimPayload);

    await insertSignedClaim({
      id: uuidv4(),
      userId: input.userId,
      documentId: input.documentId,
      claimType: ocrClaimPayload.type,
      claimPayload: JSON.stringify(ocrClaimPayload),
      signature,
      issuedAt,
    });

    return null;
  } catch (error) {
    const claimError = ClaimSigningError.ocrClaimFailed(error);
    logVerificationError(claimError, {
      userId: input.userId,
      documentId: input.documentId,
    });
    return claimError.issueCode;
  }
}

/**
 * Generate and store a signed liveness score claim.
 *
 * @returns Issue code if failed, null if successful
 */
export async function signAndStoreLivenessClaim(
  input: LivenessClaimInput
): Promise<string | null> {
  const issuedAt = new Date().toISOString();

  try {
    const antispoofScoreFixed = Math.round(input.antispoofScore * 10_000);
    const liveScoreFixed = Math.round(input.liveScore * 10_000);

    const livenessClaimPayload = {
      type: "liveness_score" as const,
      userId: input.userId,
      issuedAt,
      version: 1,
      policyVersion: POLICY_VERSION,
      documentHash: input.documentHash,
      documentHashField: input.documentHashField,
      data: {
        antispoofScore: input.antispoofScore,
        liveScore: input.liveScore,
        passed: input.passed,
        antispoofScoreFixed,
        liveScoreFixed,
      },
    };

    const signature = await signAttestationClaim(livenessClaimPayload);

    await insertSignedClaim({
      id: uuidv4(),
      userId: input.userId,
      documentId: input.documentId,
      claimType: livenessClaimPayload.type,
      claimPayload: JSON.stringify(livenessClaimPayload),
      signature,
      issuedAt,
    });

    return null;
  } catch (error) {
    const claimError = ClaimSigningError.livenessClaimFailed(error);
    logVerificationError(claimError, {
      userId: input.userId,
      documentId: input.documentId,
    });
    return claimError.issueCode;
  }
}

/**
 * Generate and store a signed face match score claim.
 *
 * @returns Issue code if failed, null if successful
 */
export async function signAndStoreFaceMatchClaim(
  input: FaceMatchClaimInput
): Promise<string | null> {
  const issuedAt = new Date().toISOString();

  try {
    const confidenceFixed = Math.round(input.confidence * 10_000);
    const thresholdFixed = Math.round(FACE_MATCH_MIN_CONFIDENCE * 10_000);

    // Compute claim hash if document hash field is available
    let claimHash: string | null = null;
    if (input.documentHashField) {
      claimHash = await computeClaimHash({
        value: confidenceFixed,
        documentHashField: input.documentHashField,
      });
    }

    const faceMatchClaimPayload = {
      type: "face_match_score" as const,
      userId: input.userId,
      issuedAt,
      version: 1,
      policyVersion: POLICY_VERSION,
      documentHash: input.documentHash,
      documentHashField: input.documentHashField,
      data: {
        confidence: input.confidence,
        confidenceFixed,
        thresholdFixed,
        passed: input.passed,
        claimHash,
      },
    };

    const signature = await signAttestationClaim(faceMatchClaimPayload);

    await insertSignedClaim({
      id: uuidv4(),
      userId: input.userId,
      documentId: input.documentId,
      claimType: faceMatchClaimPayload.type,
      claimPayload: JSON.stringify(faceMatchClaimPayload),
      signature,
      issuedAt,
    });

    return null;
  } catch (error) {
    const claimError = ClaimSigningError.faceMatchClaimFailed(error);
    logVerificationError(claimError, {
      userId: input.userId,
      documentId: input.documentId,
    });
    return claimError.issueCode;
  }
}

/**
 * Store all verification claims in parallel.
 * Failures in one claim don't prevent others from being stored.
 *
 * @returns Array of issue codes for failed claims
 */
export async function storeVerificationClaims(params: {
  userId: string;
  documentId: string | null;
  documentHash: string | null;
  documentHashField: string | null;
  documentType: string | null;
  issuerCountry: string | null;
  confidence: number | null;
  claimHashes: ClaimHashes;
  antispoofScore: number;
  liveScore: number;
  livenessPassed: boolean;
  faceMatchConfidence: number;
  faceMatchPassed: boolean;
}): Promise<string[]> {
  const issues: string[] = [];

  // Run claim storage in parallel - each is independent
  const claimTasks: Promise<string | null>[] = [];

  // OCR claim (requires document hash and hash field)
  if (params.documentHash && params.documentHashField) {
    claimTasks.push(
      signAndStoreOcrClaim({
        userId: params.userId,
        documentId: params.documentId,
        documentHash: params.documentHash,
        documentHashField: params.documentHashField,
        documentType: params.documentType,
        issuerCountry: params.issuerCountry,
        confidence: params.confidence,
        claimHashes: params.claimHashes,
      })
    );
  }

  // Liveness claim (always store if we have scores)
  if (params.antispoofScore > 0 || params.liveScore > 0) {
    claimTasks.push(
      signAndStoreLivenessClaim({
        userId: params.userId,
        documentId: params.documentId,
        documentHash: params.documentHash,
        documentHashField: params.documentHashField,
        antispoofScore: params.antispoofScore,
        liveScore: params.liveScore,
        passed: params.livenessPassed,
      })
    );
  }

  // Face match claim (always store if we have confidence)
  if (params.faceMatchConfidence > 0) {
    claimTasks.push(
      signAndStoreFaceMatchClaim({
        userId: params.userId,
        documentId: params.documentId,
        documentHash: params.documentHash,
        documentHashField: params.documentHashField,
        confidence: params.faceMatchConfidence,
        passed: params.faceMatchPassed,
      })
    );
  }

  const results = await Promise.all(claimTasks);

  for (const result of results) {
    if (result !== null) {
      issues.push(result);
    }
  }

  return issues;
}
