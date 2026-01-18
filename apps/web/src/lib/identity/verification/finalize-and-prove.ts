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

import { parseDateToInt } from "./date-utils";

/**
 * Generate all ZK proofs for identity verification.
 * Generates age, document validity, nationality, and face match proofs.
 *
 * Exported for use in dashboard verification flow where finalization
 * and proof generation happen in separate steps.
 */
export async function generateAllProofs(params: {
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
