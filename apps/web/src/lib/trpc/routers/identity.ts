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
import { signAttestationClaim } from "@/lib/crypto/signed-claims";
import {
  createIdentityDocument,
  documentHashExists,
  encryptFirstName,
  getLatestIdentityDocumentByUserId,
  getSessionFromCookie,
  getVerificationStatus,
  insertEncryptedAttribute,
  insertSignedClaim,
  updateUserName,
  upsertIdentityBundle,
  validateStepAccess,
} from "@/lib/db";
import { processDocument } from "@/lib/document";
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

import { protectedProcedure, publicProcedure, router } from "../server";

// Lower threshold for ID photos which may be older/lower quality than selfies.
const FACE_MATCH_MIN_CONFIDENCE = 0.35;

// In-memory rate limiter (document OCR). Resets on server restart.
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 10;

let lastRateLimitCleanupTimeMs = 0;

function cleanupRateLimitMap(now: number): void {
  if (now - lastRateLimitCleanupTimeMs < RATE_LIMIT_WINDOW_MS) return;
  lastRateLimitCleanupTimeMs = now;

  for (const [ip, record] of rateLimitMap.entries()) {
    if (now > record.resetTime) {
      rateLimitMap.delete(ip);
    }
  }
}

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  cleanupRateLimitMap(now);

  const record = rateLimitMap.get(ip);
  if (!record || now > record.resetTime) {
    rateLimitMap.set(ip, { count: 1, resetTime: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }

  if (record.count >= RATE_LIMIT_MAX_REQUESTS) return true;
  record.count++;
  return false;
}

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
  /**
   * OCR-only document processing used by onboarding.
   *
   * Validates onboarding session, applies rate limiting,
   * and returns extracted document fields for review.
   */
  processDocument: publicProcedure
    .input(z.object({ image: z.string().min(1, "Image is required") }))
    .mutation(async ({ ctx, input }) => {
      const session = await getSessionFromCookie();
      const validation = validateStepAccess(session, "process-document");
      if (!validation.valid) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: validation.error || "Session required",
        });
      }

      const forwarded = ctx.req.headers.get("x-forwarded-for");
      const ip = forwarded ? forwarded.split(",")[0].trim() : "unknown";

      if (isRateLimited(ip)) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "Too many requests. Please wait a moment and try again.",
        });
      }

      try {
        return await processDocument(input.image);
      } catch (error) {
        if (error instanceof Error) {
          if (
            error.message.includes("ECONNREFUSED") ||
            error.message.includes("fetch failed")
          ) {
            throw new TRPCError({
              code: "SERVICE_UNAVAILABLE",
              message:
                "Document processing service unavailable. Please try again later.",
            });
          }
        }

        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to process document. Please try a clearer image.",
        });
      }
    }),
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
      const existingDocument = getLatestIdentityDocumentByUserId(userId);
      const userSalt =
        input.userSalt ?? existingDocument?.userSalt ?? undefined;

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
        if (hashExists && !existingDocument) {
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

      let antispoofScore = 0;
      let liveScore = 0;
      let livenessPassedLocal = false;
      let facesMatchLocal = false;
      let faceMatchConfidence = 0;

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

        if (selfieFace) {
          antispoofScore = getRealScore(selfieFace);
          liveScore = getLiveScore(selfieFace);
          livenessPassedLocal =
            antispoofScore >= ANTISPOOF_REAL_THRESHOLD &&
            liveScore >= ANTISPOOF_LIVE_THRESHOLD;
        } else {
          localIssues.push("no_selfie_face");
        }

        if (selfieFace && docFace) {
          const selfieEmb = getEmbeddingVector(selfieFace);
          const docEmb = getEmbeddingVector(docFace);
          if (selfieEmb && docEmb) {
            faceMatchConfidence = human.match.similarity(docEmb, selfieEmb);
            facesMatchLocal = faceMatchConfidence >= FACE_MATCH_MIN_CONFIDENCE;
          } else {
            localIssues.push("embedding_failed");
          }
        } else {
          localIssues.push("no_document_face");
        }

        verificationResult = {
          verified: livenessPassedLocal && facesMatchLocal,
          is_live: livenessPassedLocal,
          antispoof_score: antispoofScore,
          faces_match: facesMatchLocal,
          face_match_confidence: faceMatchConfidence,
          issues: localIssues,
        };

        issues.push(...localIssues);
      } catch {
        issues.push("verification_service_failed");
      }

      const documentProcessed = Boolean(documentResult?.commitments);
      const identityDocumentId = documentProcessed ? uuidv4() : null;

      // Store signed claims for tamper-resistant verification (server measured)
      if (verificationResult) {
        const issuedAt = new Date().toISOString();
        const documentHash = documentResult?.commitments?.documentHash ?? null;
        const antispoofScoreFixed = Math.round(
          verificationResult.antispoof_score * 10000,
        );
        const liveScoreFixed = Math.round(liveScore * 10000);

        try {
          const livenessClaimPayload = {
            type: "liveness_score" as const,
            userId,
            issuedAt,
            version: 1,
            documentHash,
            data: {
              antispoofScore: verificationResult.antispoof_score,
              liveScore,
              passed: verificationResult.is_live,
              antispoofScoreFixed,
              liveScoreFixed,
            },
          };

          const livenessSignature =
            await signAttestationClaim(livenessClaimPayload);
          insertSignedClaim({
            id: uuidv4(),
            userId,
            documentId: identityDocumentId,
            claimType: livenessClaimPayload.type,
            claimPayload: JSON.stringify(livenessClaimPayload),
            signature: livenessSignature,
            issuedAt,
          });

          const faceMatchClaimPayload = {
            type: "face_match_score" as const,
            userId,
            issuedAt,
            version: 1,
            documentHash,
            data: {
              confidence: verificationResult.face_match_confidence,
              confidenceFixed: Math.round(
                verificationResult.face_match_confidence * 10000,
              ),
              thresholdFixed: Math.round(FACE_MATCH_MIN_CONFIDENCE * 10000),
              passed: verificationResult.faces_match,
            },
          };

          const faceMatchSignature = await signAttestationClaim(
            faceMatchClaimPayload,
          );
          insertSignedClaim({
            id: uuidv4(),
            userId,
            documentId: identityDocumentId,
            claimType: faceMatchClaimPayload.type,
            claimPayload: JSON.stringify(faceMatchClaimPayload),
            signature: faceMatchSignature,
            issuedAt,
          });
        } catch {
          issues.push("signed_claim_generation_failed");
        }
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

      const isDocumentValid =
        documentProcessed &&
        (documentResult?.confidence ?? 0) > 0.3 &&
        Boolean(documentResult?.extractedData?.documentNumber);
      const livenessPassed = verificationResult?.is_live ?? livenessPassedLocal;
      const facesMatch = verificationResult?.faces_match ?? facesMatchLocal;
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
        facesMatch &&
        !isDuplicateDocument;

      // Calculate birth year offset from extracted DOB (for on-chain attestation)
      const birthYearOffset = calculateBirthYearOffset(
        documentResult?.extractedData?.dateOfBirth,
      );

      const bundleStatus = verified
        ? "verified"
        : documentProcessed
          ? "failed"
          : "pending";
      upsertIdentityBundle({
        userId,
        status: bundleStatus,
        issuerId: "zentity-attestation",
      });

      if (
        documentProcessed &&
        identityDocumentId &&
        documentResult?.commitments
      ) {
        try {
          createIdentityDocument({
            id: identityDocumentId,
            userId,
            documentType: documentResult.documentType ?? null,
            issuerCountry:
              documentResult.documentOrigin ||
              documentResult.extractedData?.nationalityCode ||
              null,
            documentHash: documentResult.commitments.documentHash ?? null,
            nameCommitment: documentResult.commitments.nameCommitment ?? null,
            userSalt: documentResult.commitments.userSalt ?? null,
            birthYearOffset: birthYearOffset ?? null,
            firstNameEncrypted: firstNameEncrypted ?? null,
            verifiedAt: verified ? new Date().toISOString() : null,
            confidenceScore: documentResult.confidence ?? null,
            status: verified ? "verified" : "failed",
          });
        } catch {
          issues.push("failed_to_create_identity_document");
        }
      }

      if (fheResult?.ciphertext) {
        insertEncryptedAttribute({
          id: uuidv4(),
          userId,
          source: "web2_tfhe",
          attributeType: "birth_year",
          ciphertext: fheResult.ciphertext,
          keyId: fheResult.clientKeyId ?? null,
        });
      }

      if (dobFullFheResult?.ciphertext) {
        insertEncryptedAttribute({
          id: uuidv4(),
          userId,
          source: "web2_tfhe",
          attributeType: "dob_full",
          ciphertext: dobFullFheResult.ciphertext,
          keyId: dobFullFheResult.clientKeyId ?? null,
        });
      }

      if (genderFheResult?.ciphertext) {
        insertEncryptedAttribute({
          id: uuidv4(),
          userId,
          source: "web2_tfhe",
          attributeType: "gender_code",
          ciphertext: genderFheResult.ciphertext,
          keyId: genderFheResult.clientKeyId ?? null,
        });
      }

      if (livenessScoreFheResult?.ciphertext) {
        insertEncryptedAttribute({
          id: uuidv4(),
          userId,
          source: "web2_tfhe",
          attributeType: "liveness_score",
          ciphertext: livenessScoreFheResult.ciphertext,
          keyId: livenessScoreFheResult.clientKeyId ?? null,
        });
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
          faceMatched: facesMatch,
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
      const document = getLatestIdentityDocumentByUserId(ctx.userId);
      if (!document?.userSalt || !document.nameCommitment) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "User has not completed identity verification",
        });
      }

      const claimedCommitment = generateNameCommitment(
        input.claimedName,
        document.userSalt,
      );

      const matches = crypto.timingSafeEqual(
        Buffer.from(claimedCommitment),
        Buffer.from(document.nameCommitment),
      );

      return { matches };
    }),
});
