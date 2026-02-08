"use client";

import type { ProfileSecretPayload } from "@/lib/privacy/secrets/profile";
import type { BindingSecretResult } from "@/lib/privacy/zk/binding-secret";

import { NATIONALITY_GROUP } from "@/lib/blockchain/attestation/policy";
import { FACE_MATCH_MIN_CONFIDENCE } from "@/lib/identity/liveness/policy";
import { clearCachedBindingMaterial } from "@/lib/privacy/credentials/cache";
import { prepareBindingProofInputs } from "@/lib/privacy/zk/binding-secret";
import {
  generateAgeProof,
  generateDocValidityProof,
  generateFaceMatchProof,
  generateIdentityBindingProof,
  generateNationalityProof,
  getProofChallenge,
  getSignedClaims,
  storeProof,
} from "@/lib/privacy/zk/client";

import { parseDateToInt } from "./date-utils";

/**
 * Context for identity binding proof generation.
 * Provided when auth material is available (passkey PRF, OPAQUE export key, or wallet signature).
 */
export interface BindingContext {
  /** Result from deriveBindingSecret() */
  bindingResult: BindingSecretResult;
  /** User ID for claim hash binding */
  userId: string;
}

/**
 * Generate all ZK proofs for identity verification.
 * Generates age, document validity, nationality, face match, and identity binding proofs.
 *
 * Identity binding is mandatory — it cryptographically ties proofs to the user's
 * authentication credential, preventing replay attacks.
 */
export async function generateAllProofs(params: {
  documentId: string;
  profilePayload: ProfileSecretPayload | null;
  extractedDOB: string | null;
  extractedExpirationDate: string | null;
  extractedNationalityCode: string | null;
  onBeforeStore?: () => void;
  bindingContext: BindingContext;
}): Promise<void> {
  const {
    documentId,
    profilePayload,
    extractedDOB,
    extractedExpirationDate,
    extractedNationalityCode,
    onBeforeStore,
    bindingContext,
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

  // Proof config type for deferred storage
  interface ProofToStore {
    circuitType:
      | "age_verification"
      | "doc_validity"
      | "nationality_membership"
      | "face_match"
      | "identity_binding";
    proof: string;
    publicSignals: string[];
    generationTimeMs: number;
  }

  // Collect proof configs (NOT started promises) for truly sequential storage
  const proofsToStore: ProofToStore[] = [];
  const enqueueStore = (proof: ProofToStore) => {
    proofsToStore.push(proof);
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

  // Fetch all proof challenges in parallel
  const [
    ageChallenge,
    docChallenge,
    nationalityChallenge,
    faceChallenge,
    bindingChallenge,
  ] = await Promise.all([
    getProofChallenge("age_verification"),
    getProofChallenge("doc_validity"),
    getProofChallenge("nationality_membership"),
    getProofChallenge("face_match"),
    getProofChallenge("identity_binding"),
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

  // Generate identity binding proof (mandatory — ties proofs to user's credential)
  const bindingInputs = prepareBindingProofInputs(bindingContext.bindingResult);
  const bindingProof = await generateIdentityBindingProof(
    bindingInputs.bindingSecretField,
    bindingInputs.userIdHashField,
    bindingInputs.documentHashField,
    { nonce: bindingChallenge.nonce }
  );
  enqueueStore({ circuitType: "identity_binding", ...bindingProof });

  // Notify caller before storing (so UI can show "storing" status)
  onBeforeStore?.();

  // Store proofs sequentially to avoid SQLITE_BUSY (SQLite single-writer lock)
  // Each storeProof call does 4-6 DB operations; running them in parallel causes lock contention
  try {
    for (const proof of proofsToStore) {
      await storeProof({
        circuitType: proof.circuitType,
        proof: proof.proof,
        publicSignals: proof.publicSignals,
        generationTimeMs: proof.generationTimeMs,
        documentId,
      });
    }
  } finally {
    clearCachedBindingMaterial();
  }
}
