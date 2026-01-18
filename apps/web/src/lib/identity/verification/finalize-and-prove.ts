"use client";

import type { ProfileSecretPayload } from "@/lib/privacy/crypto/profile-secret";

import { NATIONALITY_GROUP } from "@/lib/blockchain/attestation/policy";
import { FACE_MATCH_MIN_CONFIDENCE } from "@/lib/identity/liveness/policy";
import {
  generateAgeProof,
  generateDocValidityProof,
  generateFaceMatchProof,
  generateNationalityProof,
  getProofChallenge,
  getSignedClaims,
  storeProof,
} from "@/lib/privacy/crypto/crypto-client";
import { trpc } from "@/lib/trpc/client";

import { dobToDaysSince1900 } from "./birth-year";
import { countryCodeToNumeric } from "./compliance";
import { parseDateToInt } from "./date-utils";

/**
 * Status values for identity finalization and proof generation.
 */
export type FinalizeStatus =
  | "finalizing-identity"
  | "generating-proofs"
  | "storing-proofs";

/**
 * Input parameters for identity finalization.
 */
export interface FinalizeIdentityParams {
  /** The identity draft ID from document processing */
  draftId: string;
  /** The FHE key ID to use for encryption */
  fheKeyId: string;
  /** Profile payload with extracted identity data */
  profilePayload: ProfileSecretPayload | null;
  /** Extracted DOB from store (fallback if not in profile) */
  extractedDOB: string | null;
  /** Extracted expiration date from store */
  extractedExpirationDate: string | null;
  /** Extracted nationality code from store */
  extractedNationalityCode: string | null;
  /** Callback for status updates */
  onStatus: (status: FinalizeStatus) => void;
  /** Callback to warn about Noir isolation */
  onWarnIsolation?: () => void;
  /** Callback to update document ID in store */
  onDocumentId: (documentId: string) => void;
}

/**
 * Result from identity finalization.
 */
export interface FinalizeIdentityResult {
  /** The finalized document ID */
  documentId: string;
  /** Whether identity was verified */
  verified: boolean;
}

/**
 * Wait for an async identity finalization job to complete.
 * Polls with exponential backoff up to 5 minutes.
 */
async function waitForFinalization(jobId: string): Promise<{
  verified: boolean;
  documentId?: string | null;
  issues?: string[];
}> {
  const start = Date.now();
  let attempt = 0;
  const maxWaitMs = 5 * 60 * 1000; // 5 minutes

  while (Date.now() - start < maxWaitMs) {
    const jobStatus = await trpc.identity.finalizeStatus.query({ jobId });

    if (jobStatus.status === "complete") {
      if (!jobStatus.result) {
        throw new Error("Finalization completed without a result.");
      }
      return jobStatus.result;
    }

    if (jobStatus.status === "error") {
      throw new Error(jobStatus.error || "Identity finalization failed.");
    }

    const delay = Math.min(1000 + attempt * 500, 4000);
    await new Promise((resolve) => setTimeout(resolve, delay));
    attempt += 1;
  }

  throw new Error(
    "Finalization is taking longer than expected. Please try again shortly."
  );
}

/**
 * Generate all ZK proofs for identity verification.
 * Generates age, document validity, nationality, and face match proofs.
 */
async function generateAllProofs(params: {
  documentId: string;
  profilePayload: ProfileSecretPayload | null;
  extractedDOB: string | null;
  extractedExpirationDate: string | null;
  extractedNationalityCode: string | null;
  /** Called when transitioning to storing phase */
  onBeforeStore?: () => void;
}): Promise<void> {
  const {
    documentId,
    profilePayload,
    extractedDOB,
    extractedExpirationDate,
    extractedNationalityCode,
    onBeforeStore,
  } = params;

  const claims = await getSignedClaims(documentId);
  if (!(claims.ocr && claims.faceMatch)) {
    throw new Error("Signed claims unavailable for proof generation");
  }

  const ocrClaim = claims.ocr;
  const faceClaim = claims.faceMatch;
  const ocrData = ocrClaim.data as {
    claimHashes?: {
      age?: string | null;
      docValidity?: string | null;
      nationality?: string | null;
    };
  };
  const faceData = faceClaim.data as {
    confidence?: number;
    confidenceFixed?: number;
    thresholdFixed?: number;
    claimHash?: string | null;
  };

  const documentHashField = ocrClaim.documentHashField;
  if (!documentHashField) {
    throw new Error("Missing document hash field");
  }

  // Extract claim hashes and profile data
  const ageClaimHash = ocrData.claimHashes?.age;
  const docValidityClaimHash = ocrData.claimHashes?.docValidity;
  const nationalityClaimHash = ocrData.claimHashes?.nationality;
  const dateOfBirth = profilePayload?.dateOfBirth ?? extractedDOB ?? null;
  const expiryDateInt =
    profilePayload?.expiryDateInt ?? parseDateToInt(extractedExpirationDate);
  const nationalityCode =
    profilePayload?.nationalityCode ?? extractedNationalityCode ?? null;

  // Validate required data
  if (!(dateOfBirth && ageClaimHash)) {
    throw new Error("Missing date of birth claim for age proof");
  }
  if (
    expiryDateInt === null ||
    expiryDateInt === undefined ||
    !docValidityClaimHash
  ) {
    throw new Error("Missing expiry date claim for document proof");
  }
  if (!(nationalityCode && nationalityClaimHash)) {
    throw new Error("Missing nationality claim for membership proof");
  }
  if (!faceData.claimHash) {
    throw new Error("Missing face match claim hash");
  }

  // Collect proofs to store
  const storeTasks: Promise<unknown>[] = [];
  const enqueueStore = (proof: {
    circuitType:
      | "age_verification"
      | "doc_validity"
      | "nationality_membership"
      | "face_match";
    proof: string;
    publicSignals: string[];
    generationTimeMs: number;
  }) => {
    storeTasks.push(
      storeProof({
        circuitType: proof.circuitType,
        proof: proof.proof,
        publicSignals: proof.publicSignals,
        generationTimeMs: proof.generationTimeMs,
        documentId,
      })
    );
  };

  // Prepare face match data upfront (before parallel fetch)
  const similarityFixed = ((): number | null => {
    if (typeof faceData.confidenceFixed === "number") {
      return faceData.confidenceFixed;
    }
    if (typeof faceData.confidence === "number") {
      return Math.round(faceData.confidence * 10_000);
    }
    return null;
  })();
  if (similarityFixed === null) {
    throw new Error("Missing face match confidence for proof");
  }

  const thresholdFixed =
    typeof faceData.thresholdFixed === "number"
      ? faceData.thresholdFixed
      : Math.round(FACE_MATCH_MIN_CONFIDENCE * 10_000);

  if (
    faceClaim.documentHashField &&
    faceClaim.documentHashField !== documentHashField
  ) {
    throw new Error("Face match document hash mismatch");
  }
  const faceDocumentHashField =
    faceClaim.documentHashField || documentHashField;

  // Fetch all proof challenges in parallel (async-parallel optimization)
  const [ageChallenge, docChallenge, nationalityChallenge, faceChallenge] =
    await Promise.all([
      getProofChallenge("age_verification"),
      getProofChallenge("doc_validity"),
      getProofChallenge("nationality_membership"),
      getProofChallenge("face_match"),
    ]);

  // Generate proofs sequentially (CPU-bound WASM work)
  const ageProof = await generateAgeProof(dateOfBirth, 18, {
    nonce: ageChallenge.nonce,
    documentHashField,
    claimHash: ageClaimHash,
  });
  enqueueStore({ circuitType: "age_verification", ...ageProof });

  const now = new Date();
  const currentDateInt =
    now.getFullYear() * 10_000 + (now.getMonth() + 1) * 100 + now.getDate();
  const docProof = await generateDocValidityProof(
    expiryDateInt,
    currentDateInt,
    {
      nonce: docChallenge.nonce,
      documentHashField,
      claimHash: docValidityClaimHash,
    }
  );
  enqueueStore({ circuitType: "doc_validity", ...docProof });

  const nationalityProof = await generateNationalityProof(
    nationalityCode,
    NATIONALITY_GROUP,
    {
      nonce: nationalityChallenge.nonce,
      documentHashField,
      claimHash: nationalityClaimHash,
    }
  );
  enqueueStore({ circuitType: "nationality_membership", ...nationalityProof });

  const faceProof = await generateFaceMatchProof(
    similarityFixed,
    thresholdFixed,
    {
      nonce: faceChallenge.nonce,
      documentHashField: faceDocumentHashField,
      claimHash: faceData.claimHash,
    }
  );
  enqueueStore({ circuitType: "face_match", ...faceProof });

  // Notify caller before storing (so UI can show "storing" status)
  onBeforeStore?.();

  // Store all proofs
  await Promise.all(storeTasks);
}

/**
 * Convert ZK proof errors to user-friendly messages.
 */
function formatZkError(error: unknown): string {
  const errorMessage = error instanceof Error ? error.message : "Unknown error";
  const isTimeout = errorMessage.includes("timed out");
  const isWasmError =
    errorMessage.toLowerCase().includes("wasm") ||
    errorMessage.toLowerCase().includes("module");

  if (isTimeout) {
    return "Privacy verification is taking too long. This may be due to network issues loading cryptographic libraries. Please refresh the page and try again.";
  }
  if (isWasmError) {
    return "Unable to load cryptographic libraries. Please try refreshing the page. If using a VPN or content blocker, it may be blocking required resources.";
  }
  return "Privacy verification services are temporarily unavailable. Please try again in a few minutes.";
}

/**
 * Finalize identity verification and generate ZK proofs.
 *
 * This is the shared logic between passkey and password signup flows.
 * It handles:
 * 1. Starting the async identity finalization job
 * 2. Polling for completion
 * 3. Generating all ZK proofs (age, doc validity, nationality, face match)
 * 4. Storing proofs
 *
 * @throws Error if finalization fails or proofs cannot be generated
 */
export async function finalizeIdentityAndGenerateProofs(
  params: FinalizeIdentityParams
): Promise<FinalizeIdentityResult> {
  const {
    draftId,
    fheKeyId,
    profilePayload,
    extractedDOB,
    extractedExpirationDate,
    extractedNationalityCode,
    onStatus,
    onWarnIsolation,
    onDocumentId,
  } = params;

  // Start identity finalization
  onStatus("finalizing-identity");

  const profileDob = profilePayload?.dateOfBirth ?? extractedDOB ?? null;
  const dobDays =
    profileDob !== null ? dobToDaysSince1900(profileDob) : undefined;
  const profileNationalityCode =
    profilePayload?.nationalityCode ?? extractedNationalityCode ?? null;
  const countryCodeNumeric = profileNationalityCode
    ? countryCodeToNumeric(profileNationalityCode)
    : 0;

  const job = await trpc.identity.finalizeAsync.mutate({
    draftId,
    fheKeyId,
    dobDays: dobDays ?? undefined,
    countryCodeNumeric: countryCodeNumeric > 0 ? countryCodeNumeric : undefined,
  });

  // Wait for finalization to complete
  const identityResult = await waitForFinalization(job.jobId);

  if (!identityResult.verified) {
    const issue =
      identityResult.issues?.length && identityResult.issues[0]
        ? identityResult.issues[0]
        : null;
    throw new Error(
      issue ||
        "Identity verification did not pass. Please retake your ID photo and selfie and try again."
    );
  }

  const documentId = identityResult.documentId;
  if (!documentId) {
    throw new Error(
      "Missing document context for proof generation. Please retry verification."
    );
  }

  // Update store with document ID
  onDocumentId(documentId);

  // Generate ZK proofs
  onStatus("generating-proofs");
  onWarnIsolation?.();

  try {
    await generateAllProofs({
      documentId,
      profilePayload,
      extractedDOB,
      extractedExpirationDate,
      extractedNationalityCode,
      onBeforeStore: () => onStatus("storing-proofs"),
    });
  } catch (zkError) {
    throw new Error(formatZkError(zkError));
  }

  return { documentId, verified: true };
}
