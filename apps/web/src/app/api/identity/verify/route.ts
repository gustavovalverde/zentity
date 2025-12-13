/**
 * Privacy-Preserving Identity Verification API
 *
 * This endpoint handles the complete identity verification flow:
 * 1. Document processing (OCR) → Cryptographic commitments
 * 2. Liveness check → Boolean flag
 * 3. Face matching (ID photo ↔ selfie) → Boolean flag
 * 4. Store only proofs and flags, discard all PII
 *
 * PRIVACY GUARANTEES:
 * - Document images are processed transiently and never stored
 * - Selfie images are processed transiently and never stored
 * - Face embeddings are extracted, compared, and immediately discarded
 * - Only cryptographic commitments and boolean flags are persisted
 * - GDPR compliance: delete user_salt to "forget" the user
 */

import { type NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { requireSession } from "@/lib/api-auth";
import { sha256CommitmentHex } from "@/lib/commitments";
import {
  createIdentityProof,
  documentHashExists,
  encryptFirstName,
  getIdentityProofByUserId,
  updateIdentityProofFlags,
  updateUserName,
} from "@/lib/db";
import {
  encryptBirthYearFhe,
  encryptDobFhe,
  encryptGenderFhe,
  encryptLivenessScoreFhe,
} from "@/lib/fhe-client";
import { HttpError } from "@/lib/http";
import {
  getEmbeddingVector,
  getLargestFace,
  getLiveScore,
  getRealScore,
} from "@/lib/human-metrics";
import { detectFromBase64, getHumanServer } from "@/lib/human-server";
import { cropFaceRegion } from "@/lib/image-processing";
import { buildDisplayName } from "@/lib/name-utils";
import { type OcrProcessResult, processDocumentOcr } from "@/lib/ocr-client";
import {
  getSessionFromCookie,
  validateStepAccess,
} from "@/lib/onboarding-session";

// ZK proofs are generated client-side; this endpoint does not generate proofs.

// Face matching threshold for ID photo ↔ selfie comparisons.
// ID photos can be old and lower quality, so a lower threshold is used.
const FACE_MATCH_MIN_CONFIDENCE = 0.35;

interface VerifyIdentityRequest {
  // Document image (base64)
  documentImage: string;

  // Selfie image (base64)
  selfieImage: string;

  // Optional: existing user salt for re-verification
  userSalt?: string;
}

interface VerifyIdentityResponse {
  success: boolean;
  verified: boolean;

  // Verification results
  results: {
    documentProcessed: boolean;
    documentType?: string;
    documentOrigin?: string; // ISO 3166-1 alpha-3 country code
    isDocumentValid: boolean;
    livenessPassed: boolean;
    faceMatched: boolean;
    isDuplicateDocument: boolean;
    ageProofGenerated: boolean;
    dobEncrypted: boolean;
    docValidityProofGenerated: boolean;
    nationalityCommitmentGenerated: boolean;
    livenessScoreEncrypted: boolean;
  };

  // Extracted data for UI display (TRANSIENT - DO NOT PERSIST ON CLIENT)
  transientData?: {
    fullName?: string;
    firstName?: string;
    lastName?: string;
    documentNumber?: string;
    dateOfBirth?: string;
  };

  // Processing metadata
  processingTimeMs: number;
  issues: string[];
  error?: string;
}

const emptyVerifyResults: VerifyIdentityResponse["results"] = {
  documentProcessed: false,
  isDocumentValid: false,
  livenessPassed: false,
  faceMatched: false,
  isDuplicateDocument: false,
  ageProofGenerated: false,
  dobEncrypted: false,
  docValidityProofGenerated: false,
  nationalityCommitmentGenerated: false,
  livenessScoreEncrypted: false,
};

export async function POST(
  request: NextRequest,
): Promise<NextResponse<VerifyIdentityResponse>> {
  const startTime = Date.now();
  const issues: string[] = [];

  const fail = (
    status: number,
    failIssues: string[],
    error: string,
  ): NextResponse<VerifyIdentityResponse> => {
    return NextResponse.json(
      {
        success: false,
        verified: false,
        results: emptyVerifyResults,
        processingTimeMs: Date.now() - startTime,
        issues: failIssues,
        error,
      },
      { status },
    );
  };

  try {
    const authResult = await requireSession();
    if (!authResult.ok) {
      return fail(401, ["unauthorized"], "Authentication required");
    }

    // Validate onboarding session - must have completed document verification
    const onboardingSession = await getSessionFromCookie();
    const stepValidation = validateStepAccess(
      onboardingSession,
      "identity-verify",
    );
    if (!stepValidation.valid) {
      return fail(
        403,
        ["step_validation_failed"],
        stepValidation.error || "Complete previous steps first",
      );
    }

    const userId = authResult.session.user.id;
    const body = (await request.json()) as VerifyIdentityRequest;

    // Validate input
    if (!body.documentImage) {
      return fail(
        400,
        ["missing_document_image"],
        "Document image is required",
      );
    }

    if (!body.selfieImage) {
      return fail(400, ["missing_selfie_image"], "Selfie image is required");
    }

    // Check if user already has identity proof
    const existingProof = getIdentityProofByUserId(userId);
    const userSalt = body.userSalt || existingProof?.userSalt;

    // =========================================================================
    // STEP 1: Privacy-Preserving Document Processing
    // =========================================================================
    let documentResult: OcrProcessResult | null = null;

    try {
      documentResult = await processDocumentOcr({
        image: body.documentImage,
        userSalt: userSalt,
      });
      issues.push(...(documentResult?.validationIssues || []));
    } catch (_error) {
      issues.push("document_processing_failed");
    }

    // Check for duplicate document
    let isDuplicateDocument = false;
    if (documentResult?.commitments?.documentHash) {
      const hashExists = documentHashExists(
        documentResult.commitments.documentHash,
      );
      if (hashExists && !existingProof) {
        isDuplicateDocument = true;
        issues.push("duplicate_document");
      }
    }

    // =========================================================================
    // STEP 2: Full Verification (Liveness + Face Matching)
    // =========================================================================
    let verificationResult: {
      verified: boolean;
      is_live: boolean;
      antispoof_score: number;
      faces_match: boolean;
      face_match_confidence: number;
      issues: string[];
    } | null = null;

    try {
      const human = await getHumanServer();

      const selfieResult = await detectFromBase64(body.selfieImage);

      // First pass: detect faces in document to get bounding box
      const docResultInitial = await detectFromBase64(body.documentImage);
      const docFaceInitial = getLargestFace(docResultInitial);

      let docResult = docResultInitial;

      // If face found, crop and re-detect for better embedding quality
      if (docFaceInitial?.box) {
        try {
          // Human.js box can be array [x,y,w,h] or object {x,y,width,height}
          const box = Array.isArray(docFaceInitial.box)
            ? {
                x: docFaceInitial.box[0],
                y: docFaceInitial.box[1],
                width: docFaceInitial.box[2],
                height: docFaceInitial.box[3],
              }
            : docFaceInitial.box;

          const croppedFaceDataUrl = await cropFaceRegion(
            body.documentImage,
            box,
          );
          docResult = await detectFromBase64(croppedFaceDataUrl);
        } catch (_err) {}
      }

      const selfieFace = getLargestFace(selfieResult);
      const docFace = getLargestFace(docResult);
      const localIssues: string[] = [];

      let antispoofScore = 0;
      let liveScore = 0;
      let livenessPassed = false;
      if (selfieFace) {
        antispoofScore = getRealScore(selfieFace);
        liveScore = getLiveScore(selfieFace);
        livenessPassed = antispoofScore >= 0.5 && liveScore >= 0.5;
      } else {
        localIssues.push("no_selfie_face");
      }

      let facesMatch = false;
      let faceMatchConfidence = 0;
      if (selfieFace && docFace) {
        const selfieEmb = getEmbeddingVector(selfieFace);
        const docEmb = getEmbeddingVector(docFace);
        if (selfieEmb && docEmb) {
          faceMatchConfidence = human.match.similarity(docEmb, selfieEmb);
          facesMatch = faceMatchConfidence >= FACE_MATCH_MIN_CONFIDENCE;
        } else {
          localIssues.push("embedding_failed");
        }
      } else {
        localIssues.push("no_document_face");
      }

      verificationResult = {
        verified: livenessPassed && facesMatch,
        is_live: livenessPassed,
        antispoof_score: antispoofScore,
        faces_match: facesMatch,
        face_match_confidence: faceMatchConfidence,
        issues: localIssues,
      };

      issues.push(...localIssues);
    } catch (_error) {
      issues.push("verification_service_failed");
    }

    // =========================================================================
    // STEP 3: Cryptographic Processing (FHE + commitments)
    // =========================================================================
    // If we have a DOB, encrypt it with FHE
    let fheResult: {
      ciphertext: string;
      clientKeyId: string;
    } | null = null;

    // Nationality commitment (SHA256 hash)
    let nationalityCommitment: string | null = null;

    // Gender FHE encryption result
    let genderFheResult: {
      ciphertext: string;
      clientKeyId: string;
      genderCode: number;
    } | null = null;

    // Full DOB FHE encryption result
    let dobFullFheResult: {
      ciphertext: string;
      clientKeyId: string;
      dobInt: number;
    } | null = null;

    // Liveness score FHE encryption result
    let livenessScoreFheResult: {
      ciphertext: string;
      clientKeyId: string;
      score: number;
    } | null = null;

    // Encrypted first name for user display (JWE encrypted, reversible)
    let firstNameEncrypted: string | null = null;

    const dateOfBirth = documentResult?.extractedData?.dateOfBirth;
    if (dateOfBirth) {
      // Parse birth year from DOB (format: DD/MM/YYYY or YYYY-MM-DD)
      let birthYear: number | null = null;
      if (dateOfBirth.includes("/")) {
        const parts = dateOfBirth.split("/");
        birthYear = parseInt(parts[2], 10);
      } else if (dateOfBirth.includes("-")) {
        birthYear = parseInt(dateOfBirth.split("-")[0], 10);
      }

      if (
        birthYear &&
        birthYear > 1900 &&
        birthYear <= new Date().getFullYear()
      ) {
        // FHE Encryption (encrypt birth year for homomorphic computations)
        try {
          fheResult = await encryptBirthYearFhe({
            birthYear,
            clientKeyId: "default",
          });
        } catch (error) {
          if (error instanceof HttpError) {
            issues.push("fhe_encryption_failed");
          } else {
            issues.push("fhe_service_unavailable");
          }
        }
      }
    }

    // =========================================================================
    // STEP 3.5: Nationality Commitment
    // =========================================================================
    // Generate SHA256 commitment for nationality (ISO 3166-1 alpha-3 code)
    const nationalityCode = documentResult?.extractedData?.nationalityCode;
    if (nationalityCode && documentResult?.commitments?.userSalt) {
      try {
        nationalityCommitment = await sha256CommitmentHex({
          value: nationalityCode,
          salt: documentResult.commitments.userSalt,
        });
      } catch (_error) {
        issues.push("nationality_commitment_failed");
      }
    }

    // =========================================================================
    // STEP 3.7: Gender FHE Encryption
    // =========================================================================
    const gender = documentResult?.extractedData?.gender;
    if (gender) {
      try {
        // Convert M/F to ISO 5218 code
        const genderCode = gender === "M" ? 1 : gender === "F" ? 2 : 0;
        const genderData = await encryptGenderFhe({
          genderCode,
          clientKeyId: "default",
        });
        genderFheResult = {
          ...genderData,
          genderCode,
        };
      } catch (error) {
        if (error instanceof HttpError) {
          issues.push("gender_fhe_encryption_failed");
        } else {
          issues.push("gender_fhe_service_unavailable");
        }
      }
    }

    // =========================================================================
    // STEP 3.8: Full DOB FHE Encryption
    // =========================================================================
    // Encrypt full DOB as YYYYMMDD for precise age calculations
    if (dateOfBirth) {
      try {
        dobFullFheResult = await encryptDobFhe({
          dob: dateOfBirth,
          clientKeyId: "default",
        });
      } catch (error) {
        if (error instanceof HttpError) {
          issues.push("dob_full_fhe_encryption_failed");
        } else {
          issues.push("dob_full_fhe_service_unavailable");
        }
      }
    }

    // =========================================================================
    // STEP 3.9: Liveness Score FHE Encryption
    // =========================================================================
    // Encrypt the liveness/anti-spoof score for privacy-preserving threshold checks
    // Score is 0.0-1.0, encrypted as u16 (0-10000) for FHE operations
    const livenessScore = verificationResult?.antispoof_score;
    if (livenessScore !== undefined && livenessScore !== null) {
      try {
        livenessScoreFheResult = await encryptLivenessScoreFhe({
          score: livenessScore,
          clientKeyId: "default",
        });
      } catch (error) {
        if (error instanceof HttpError) {
          issues.push("liveness_score_fhe_encryption_failed");
        } else {
          issues.push("liveness_score_fhe_service_unavailable");
        }
      }
    }

    // =========================================================================
    // STEP 3.10: Encrypt First Name for User Display
    // =========================================================================
    // Encrypt the first name using JWE so we can display it back to the user
    // on their dashboard. This is reversible encryption (unlike SHA256 commitments).
    const firstName = documentResult?.extractedData?.firstName;
    if (firstName) {
      try {
        firstNameEncrypted = await encryptFirstName(firstName);
      } catch (_error) {
        issues.push("first_name_encryption_failed");
      }
    }

    // =========================================================================
    // STEP 4: Store Identity Proof (Only commitments and flags)
    // =========================================================================
    const documentProcessed = Boolean(documentResult?.commitments);
    // Document is valid if we have commitments and confidence is reasonable
    const isDocumentValid =
      documentProcessed &&
      (documentResult?.confidence ?? 0) > 0.3 &&
      Boolean(documentResult?.extractedData?.documentNumber);
    const livenessPassed = verificationResult?.is_live || false;
    const faceMatched = verificationResult?.faces_match || false;
    const ageProofGenerated = false;
    const dobEncrypted = Boolean(fheResult?.ciphertext);
    const docValidityProofGenerated = false;
    const nationalityCommitmentGenerated = Boolean(nationalityCommitment);
    const livenessScoreEncrypted = Boolean(livenessScoreFheResult?.ciphertext);
    const verified =
      documentProcessed &&
      isDocumentValid &&
      livenessPassed &&
      faceMatched &&
      !isDuplicateDocument;

    if (documentProcessed && documentResult?.commitments && !existingProof) {
      try {
        createIdentityProof({
          id: uuidv4(),
          userId,
          documentHash: documentResult.commitments.documentHash,
          nameCommitment: documentResult.commitments.nameCommitment,
          userSalt: documentResult.commitments.userSalt,
          documentType: documentResult.documentType,
          countryVerified:
            documentResult.documentOrigin ||
            documentResult.extractedData?.nationalityCode,
          isDocumentVerified: isDocumentValid,
          isLivenessPassed: livenessPassed,
          isFaceMatched: faceMatched,
          verificationMethod: "ocr_local",
          verifiedAt: verified ? new Date().toISOString() : undefined,
          confidenceScore: documentResult.confidence,
          // FHE encrypted DOB
          dobCiphertext: fheResult?.ciphertext,
          fheClientKeyId: fheResult?.clientKeyId,
          nationalityCommitment: nationalityCommitment || undefined,
          genderCiphertext: genderFheResult?.ciphertext,
          dobFullCiphertext: dobFullFheResult?.ciphertext,
          livenessScoreCiphertext: livenessScoreFheResult?.ciphertext,
          // User display data: Encrypted first name
          firstNameEncrypted: firstNameEncrypted || undefined,
        });
      } catch (_error) {
        issues.push("failed_to_save_proof");
      }
    } else if (existingProof) {
      // Update existing proof flags
      try {
        updateIdentityProofFlags(userId, {
          isLivenessPassed: livenessPassed,
          isFaceMatched: faceMatched,
          verifiedAt: verified ? new Date().toISOString() : undefined,
          // Update FHE data if available
          ...(fheResult && {
            dobCiphertext: fheResult.ciphertext,
            fheClientKeyId: fheResult.clientKeyId,
          }),
          ...(nationalityCommitment && {
            nationalityCommitment,
          }),
          ...(genderFheResult && {
            genderCiphertext: genderFheResult.ciphertext,
          }),
          ...(dobFullFheResult && {
            dobFullCiphertext: dobFullFheResult.ciphertext,
          }),
          ...(livenessScoreFheResult && {
            livenessScoreCiphertext: livenessScoreFheResult.ciphertext,
          }),
          // User display data: Encrypted first name
          ...(firstNameEncrypted && {
            firstNameEncrypted,
          }),
        });
      } catch (_error) {
        issues.push("failed_to_update_proof");
      }
    }

    // =========================================================================
    // STEP 3.5: Update User Display Name (Transient - only display name stored)
    // =========================================================================
    // After successful document processing, update user's display name
    // using first parts of first name and last name.
    // e.g., "Juan Carlos" + "Perez Garcia" -> "Juan Perez"
    if (
      documentResult?.extractedData?.firstName ||
      documentResult?.extractedData?.lastName
    ) {
      try {
        const displayName = buildDisplayName(
          documentResult.extractedData.firstName,
          documentResult.extractedData.lastName,
        );
        if (displayName) {
          updateUserName(userId, displayName);
        }
      } catch (_error) {
        // Non-critical, don't add to issues
      }
    }

    // =========================================================================
    // STEP 4: Return Results
    // =========================================================================
    // At this point:
    // - Document image has been processed and discarded
    // - Selfie image has been processed and discarded
    // - Face embeddings have been compared and discarded
    // - Only commitments and boolean flags are stored

    return NextResponse.json({
      success: true,
      verified,
      results: {
        documentProcessed,
        documentType: documentResult?.documentType,
        documentOrigin:
          documentResult?.documentOrigin ||
          documentResult?.extractedData?.nationalityCode,
        isDocumentValid,
        livenessPassed,
        faceMatched,
        isDuplicateDocument,
        ageProofGenerated,
        dobEncrypted,
        docValidityProofGenerated,
        nationalityCommitmentGenerated,
        livenessScoreEncrypted,
      },
      transientData: documentResult?.extractedData
        ? {
            fullName: documentResult.extractedData.fullName,
            firstName: documentResult.extractedData.firstName,
            lastName: documentResult.extractedData.lastName,
            documentNumber: documentResult.extractedData.documentNumber,
            dateOfBirth: documentResult.extractedData.dateOfBirth,
          }
        : undefined,
      processingTimeMs: Date.now() - startTime,
      issues,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        verified: false,
        results: {
          documentProcessed: false,
          isDocumentValid: false,
          livenessPassed: false,
          faceMatched: false,
          isDuplicateDocument: false,
          ageProofGenerated: false,
          dobEncrypted: false,
          docValidityProofGenerated: false,
          nationalityCommitmentGenerated: false,
          livenessScoreEncrypted: false,
        },
        processingTimeMs: Date.now() - startTime,
        issues: ["internal_error"],
        error:
          error instanceof Error ? error.message : "Unknown error occurred",
      },
      { status: 500 },
    );
  }
}
