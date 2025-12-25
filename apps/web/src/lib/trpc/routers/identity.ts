/**
 * Identity Router
 *
 * Orchestrates the full identity verification flow:
 * 1. Document OCR + commitment generation (privacy-preserving hashes)
 * 2. Face detection on selfie with anti-spoofing checks
 * 3. Face matching between document photo and selfie
 * 4. FHE encryption of sensitive fields (DOB, gender, liveness score)
 * 5. Nationality commitment generation
 *
 * Privacy principle: Raw PII is never stored. Only cryptographic commitments,
 * FHE ciphertexts, and verification flags are persisted. Images are processed
 * transiently and discarded.
 */
import "server-only";

import type { OcrProcessResult } from "@/lib/document";

import crypto from "node:crypto";

import { TRPCError } from "@trpc/server";
import { v4 as uuidv4 } from "uuid";
import z from "zod";

import { sha256CommitmentHex } from "@/lib/crypto";
import {
  encryptBirthYearFhe,
  encryptDobFhe,
  encryptGenderFhe,
  encryptLivenessScoreFhe,
} from "@/lib/crypto/fhe-client";
import {
  createIdentityProof,
  documentHashExists,
  encryptFirstName,
  getIdentityProofByUserId,
  getSessionFromCookie,
  getVerificationStatus,
  updateIdentityProofFlags,
  updateUserName,
  validateStepAccess,
} from "@/lib/db";
import { cropFaceRegion } from "@/lib/document/image-processing";
import { processDocumentOcr } from "@/lib/document/ocr-client";
import { calculateBirthYearOffset } from "@/lib/identity/birth-year";
import {
  ANTISPOOF_LIVE_THRESHOLD,
  ANTISPOOF_REAL_THRESHOLD,
} from "@/lib/liveness";
import {
  getEmbeddingVector,
  getLargestFace,
  getLiveScore,
  getRealScore,
} from "@/lib/liveness/human-metrics";
import { detectFromBase64, getHumanServer } from "@/lib/liveness/human-server";
import { buildDisplayName, HttpError } from "@/lib/utils";

import { protectedProcedure, router } from "../server";

// Lower threshold for ID photos which may be older/lower quality than selfies.
const FACE_MATCH_MIN_CONFIDENCE = 0.35;

interface VerifyIdentityResponse {
  success: boolean;
  verified: boolean;

  results: {
    documentProcessed: boolean;
    documentType?: string;
    documentOrigin?: string;
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

  transientData?: {
    fullName?: string;
    firstName?: string;
    lastName?: string;
    documentNumber?: string;
    dateOfBirth?: string;
  };

  processingTimeMs: number;
  issues: string[];
  error?: string;
}

/**
 * Normalizes a name for commitment generation.
 * Removes diacritics, uppercases, and collapses whitespace.
 */
function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .split(/\s+/)
    .filter(Boolean)
    .join(" ");
}

/**
 * Generates a SHA-256 commitment of the normalized name with user salt.
 * Used for privacy-preserving name verification.
 */
function generateNameCommitment(fullName: string, userSalt: string): string {
  const normalized = normalizeName(fullName);
  const data = `${normalized}:${userSalt}`;
  return crypto.createHash("sha256").update(data).digest("hex");
}

export const identityRouter = router({
  /** Returns the current verification status for the authenticated user. */
  status: protectedProcedure.query(({ ctx }) => {
    return getVerificationStatus(ctx.userId);
  }),

  /**
   * Main identity verification endpoint.
   *
   * Flow:
   * 1. Validate onboarding session step access
   * 2. OCR document → extract data + generate commitments
   * 3. Check for duplicate documents (prevents multi-account fraud)
   * 4. Detect faces in selfie and document photo
   * 5. Run anti-spoofing checks on selfie
   * 6. Compare face embeddings for identity match
   * 7. Encrypt sensitive fields via FHE service
   * 8. Store identity proof (only commitments, not raw PII)
   */
  verify: protectedProcedure
    .input(
      z.object({
        documentImage: z.string().min(1),
        selfieImage: z.string().min(1),
        userSalt: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const startTime = Date.now();
      const issues: string[] = [];

      const onboardingSession = await getSessionFromCookie();
      const stepValidation = validateStepAccess(
        onboardingSession,
        "identity-verify",
      );
      if (!stepValidation.valid) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: stepValidation.error || "Complete previous steps first",
        });
      }

      const userId = ctx.userId;
      const existingProof = getIdentityProofByUserId(userId);
      const userSalt = input.userSalt || existingProof?.userSalt;

      let documentResult: OcrProcessResult | null = null;
      try {
        documentResult = await processDocumentOcr({
          image: input.documentImage,
          userSalt,
        });
        issues.push(...(documentResult?.validationIssues || []));
      } catch {
        issues.push("document_processing_failed");
      }

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

        const selfieResult = await detectFromBase64(input.selfieImage);

        const docResultInitial = await detectFromBase64(input.documentImage);
        const docFaceInitial = getLargestFace(docResultInitial);

        let docResult = docResultInitial;

        if (docFaceInitial?.box) {
          try {
            const box = Array.isArray(docFaceInitial.box)
              ? {
                  x: docFaceInitial.box[0],
                  y: docFaceInitial.box[1],
                  width: docFaceInitial.box[2],
                  height: docFaceInitial.box[3],
                }
              : docFaceInitial.box;

            const croppedFaceDataUrl = await cropFaceRegion(
              input.documentImage,
              box,
            );
            docResult = await detectFromBase64(croppedFaceDataUrl);
          } catch {}
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
          livenessPassed =
            antispoofScore >= ANTISPOOF_REAL_THRESHOLD &&
            liveScore >= ANTISPOOF_LIVE_THRESHOLD;
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
      } catch {
        issues.push("verification_service_failed");
      }

      let fheResult: { ciphertext: string; clientKeyId: string } | null = null;
      let nationalityCommitment: string | null = null;
      let genderFheResult: {
        ciphertext: string;
        clientKeyId: string;
        genderCode: number;
      } | null = null;
      let dobFullFheResult: {
        ciphertext: string;
        clientKeyId: string;
        dobInt: number;
      } | null = null;
      let livenessScoreFheResult: {
        ciphertext: string;
        clientKeyId: string;
        score: number;
      } | null = null;
      let firstNameEncrypted: string | null = null;

      const dateOfBirth = documentResult?.extractedData?.dateOfBirth;
      if (dateOfBirth) {
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

      const nationalityCode = documentResult?.extractedData?.nationalityCode;
      if (nationalityCode && documentResult?.commitments?.userSalt) {
        try {
          nationalityCommitment = await sha256CommitmentHex({
            value: nationalityCode,
            salt: documentResult.commitments.userSalt,
          });
        } catch {
          issues.push("nationality_commitment_failed");
        }
      }

      const gender = documentResult?.extractedData?.gender;
      if (gender) {
        try {
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

      const firstName = documentResult?.extractedData?.firstName;
      if (firstName) {
        try {
          firstNameEncrypted = await encryptFirstName(firstName);
        } catch {
          issues.push("first_name_encryption_failed");
        }
      }

      const documentProcessed = Boolean(documentResult?.commitments);
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
      const livenessScoreEncrypted = Boolean(
        livenessScoreFheResult?.ciphertext,
      );
      const verified =
        documentProcessed &&
        isDocumentValid &&
        livenessPassed &&
        faceMatched &&
        !isDuplicateDocument;

      // Calculate birth year offset from extracted DOB (for on-chain attestation)
      const birthYearOffset = calculateBirthYearOffset(
        documentResult?.extractedData?.dateOfBirth,
      );

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
            dobCiphertext: fheResult?.ciphertext,
            fheClientKeyId: fheResult?.clientKeyId,
            nationalityCommitment: nationalityCommitment || undefined,
            genderCiphertext: genderFheResult?.ciphertext,
            dobFullCiphertext: dobFullFheResult?.ciphertext,
            livenessScoreCiphertext: livenessScoreFheResult?.ciphertext,
            firstNameEncrypted: firstNameEncrypted || undefined,
            birthYearOffset,
          });
        } catch {
          issues.push("failed_to_save_proof");
        }
      } else if (existingProof) {
        try {
          updateIdentityProofFlags(userId, {
            isLivenessPassed: livenessPassed,
            isFaceMatched: faceMatched,
            verifiedAt: verified ? new Date().toISOString() : undefined,
            ...(fheResult && {
              dobCiphertext: fheResult.ciphertext,
              fheClientKeyId: fheResult.clientKeyId,
            }),
            ...(nationalityCommitment && { nationalityCommitment }),
            ...(genderFheResult && {
              genderCiphertext: genderFheResult.ciphertext,
            }),
            ...(dobFullFheResult && {
              dobFullCiphertext: dobFullFheResult.ciphertext,
            }),
            ...(livenessScoreFheResult && {
              livenessScoreCiphertext: livenessScoreFheResult.ciphertext,
            }),
            ...(firstNameEncrypted && { firstNameEncrypted }),
            ...(birthYearOffset !== undefined && { birthYearOffset }),
          });
        } catch {
          issues.push("failed_to_update_proof");
        }
      }

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
        } catch {}
      }

      return {
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
      } satisfies VerifyIdentityResponse;
    }),

  /**
   * Verifies a claimed name against the stored commitment.
   * Uses constant-time comparison to prevent timing attacks.
   * Does not reveal the actual stored name.
   */
  verifyName: protectedProcedure
    .input(
      z.object({
        claimedName: z.string().trim().min(1, "Claimed name is required"),
      }),
    )
    .mutation(({ ctx, input }) => {
      const proof = getIdentityProofByUserId(ctx.userId);
      if (!proof) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "User has not completed identity verification",
        });
      }

      const claimedCommitment = generateNameCommitment(
        input.claimedName,
        proof.userSalt,
      );

      const matches = crypto.timingSafeEqual(
        Buffer.from(claimedCommitment),
        Buffer.from(proof.nameCommitment),
      );

      return { matches };
    }),
});
