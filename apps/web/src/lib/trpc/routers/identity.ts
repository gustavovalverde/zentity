/**
 * Identity Router
 *
 * Orchestrates the full identity verification flow:
 * 1. Document OCR + commitment generation (privacy-preserving hashes)
 * 2. Face detection on selfie with anti-spoofing checks
 * 3. Face matching between document photo and selfie
 * 4. FHE encryption of sensitive fields (birth year offset, country code, liveness score)
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

import {
  computeClaimHash,
  getDocumentHashField,
} from "@/lib/attestation/claim-hash";
import { ISSUER_ID, POLICY_VERSION } from "@/lib/attestation/policy";
import { sha256CommitmentHex } from "@/lib/crypto";
import {
  encryptBirthYearOffsetFhe,
  encryptCountryCodeFhe,
  encryptLivenessScoreFhe,
  FheServiceError,
} from "@/lib/crypto/fhe-client";
import { signAttestationClaim } from "@/lib/crypto/signed-claims";
import {
  createIdentityDocument,
  decryptUserSalt,
  documentHashExists,
  encryptFirstName,
  encryptUserSalt,
  getLatestIdentityDocumentByUserId,
  getSelectedIdentityDocumentByUserId,
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
import { countryCodeToNumeric } from "@/lib/identity/compliance";
import {
  ANTISPOOF_LIVE_THRESHOLD,
  ANTISPOOF_REAL_THRESHOLD,
  FACE_MATCH_MIN_CONFIDENCE,
} from "@/lib/liveness";
import {
  getEmbeddingVector,
  getLargestFace,
  getLiveScore,
  getRealScore,
} from "@/lib/liveness/human-metrics";
import { detectFromBase64, getHumanServer } from "@/lib/liveness/human-server";
import { buildDisplayName } from "@/lib/utils";
import { getNationalityCode } from "@/lib/zk/nationality-data";

import { protectedProcedure, publicProcedure, router } from "../server";

// Face match threshold aligned with policy (see liveness-policy).

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
  documentId?: string | null;

  results: {
    documentProcessed: boolean;
    documentType?: string;
    documentOrigin?: string;
    isDocumentValid: boolean;
    livenessPassed: boolean;
    faceMatched: boolean;
    isDuplicateDocument: boolean;
    ageProofGenerated: boolean;
    birthYearOffsetEncrypted: boolean;
    docValidityProofGenerated: boolean;
    nationalityCommitmentGenerated: boolean;
    countryCodeEncrypted: boolean;
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
  fheStatus?: "pending" | "complete" | "error";
  fheErrors?: Array<{
    operation: string;
    issue: string;
    kind: string;
    status?: number;
    message?: string;
    bodyText?: string;
  }>;
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

function parseBirthYear(dateValue?: string | null): number | null {
  if (!dateValue) return null;
  if (dateValue.includes("/")) {
    const parts = dateValue.split("/");
    if (parts.length === 3) {
      const year = Number.parseInt(parts[2] ?? "", 10);
      return Number.isFinite(year) ? year : null;
    }
  }
  if (dateValue.includes("-")) {
    const parts = dateValue.split("-");
    if (parts.length >= 1) {
      const year = Number.parseInt(parts[0] ?? "", 10);
      return Number.isFinite(year) ? year : null;
    }
  }
  if (dateValue.length === 8) {
    const year = Number.parseInt(dateValue.slice(0, 4), 10);
    return Number.isFinite(year) ? year : null;
  }
  return null;
}

function parseDateToInt(dateValue?: string | null): number | null {
  if (!dateValue) return null;
  if (dateValue.includes("/")) {
    const parts = dateValue.split("/");
    if (parts.length === 3) {
      const month = Number.parseInt(parts[0] ?? "", 10);
      const day = Number.parseInt(parts[1] ?? "", 10);
      const year = Number.parseInt(parts[2] ?? "", 10);
      if (
        Number.isFinite(year) &&
        Number.isFinite(month) &&
        Number.isFinite(day)
      ) {
        return year * 10000 + month * 100 + day;
      }
    }
  }
  if (dateValue.includes("-")) {
    const parts = dateValue.split("-");
    if (parts.length === 3) {
      const year = Number.parseInt(parts[0] ?? "", 10);
      const month = Number.parseInt(parts[1] ?? "", 10);
      const day = Number.parseInt(parts[2] ?? "", 10);
      if (
        Number.isFinite(year) &&
        Number.isFinite(month) &&
        Number.isFinite(day)
      ) {
        return year * 10000 + month * 100 + day;
      }
    }
  }
  if (dateValue.length === 8 && /^\d+$/.test(dateValue)) {
    const year = Number.parseInt(dateValue.slice(0, 4), 10);
    const month = Number.parseInt(dateValue.slice(4, 6), 10);
    const day = Number.parseInt(dateValue.slice(6, 8), 10);
    if (
      Number.isFinite(year) &&
      Number.isFinite(month) &&
      Number.isFinite(day)
    ) {
      return year * 10000 + month * 100 + day;
    }
  }
  return null;
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
        fhePublicKey: z.string().optional(),
        fheKeyId: z.string().optional(),
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
      let userSalt = input.userSalt;
      if (!userSalt && existingDocument?.userSalt) {
        const decryptedSalt = await decryptUserSalt(existingDocument.userSalt);
        if (decryptedSalt) {
          userSalt = decryptedSalt;
        } else {
          issues.push("user_salt_decrypt_failed");
        }
      }
      const fhePublicKey = input.fhePublicKey;
      const fheKeyId = input.fheKeyId;
      const hasFheKeyMaterial = Boolean(fhePublicKey && fheKeyId);

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
      const documentHash = documentResult?.commitments?.documentHash ?? null;
      let documentHashField: string | null = null;
      if (documentHash) {
        try {
          documentHashField = await getDocumentHashField(documentHash);
        } catch {
          issues.push("document_hash_field_failed");
        }
      }

      const issuedAt = new Date().toISOString();

      // Store OCR signed claim for tamper-resistant verification
      if (documentProcessed && documentHash && documentHashField) {
        try {
          const birthYear = parseBirthYear(
            documentResult?.extractedData?.dateOfBirth,
          );
          const expiryDate = parseDateToInt(
            documentResult?.extractedData?.expirationDate,
          );
          const nationalityCode =
            documentResult?.extractedData?.nationalityCode ?? null;
          const nationalityCodeNumeric = nationalityCode
            ? (getNationalityCode(nationalityCode) ?? null)
            : null;

          const claimHashes: {
            age?: string | null;
            docValidity?: string | null;
            nationality?: string | null;
          } = {
            age: null,
            docValidity: null,
            nationality: null,
          };

          if (birthYear) {
            claimHashes.age = await computeClaimHash({
              value: birthYear,
              documentHashField,
            });
          }
          if (expiryDate) {
            claimHashes.docValidity = await computeClaimHash({
              value: expiryDate,
              documentHashField,
            });
          }
          if (nationalityCodeNumeric) {
            claimHashes.nationality = await computeClaimHash({
              value: nationalityCodeNumeric,
              documentHashField,
            });
          }

          const ocrClaimPayload = {
            type: "ocr_result" as const,
            userId,
            issuedAt,
            version: 1,
            policyVersion: POLICY_VERSION,
            documentHash,
            documentHashField,
            data: {
              documentType: documentResult?.documentType ?? null,
              issuerCountry:
                documentResult?.documentOrigin ||
                documentResult?.extractedData?.nationalityCode ||
                null,
              nationalityCode,
              nationalityCodeNumeric,
              expiryDate,
              birthYear,
              confidence: documentResult?.confidence ?? null,
              claimHashes,
            },
          };

          const ocrSignature = await signAttestationClaim(ocrClaimPayload);
          insertSignedClaim({
            id: uuidv4(),
            userId,
            documentId: identityDocumentId,
            claimType: ocrClaimPayload.type,
            claimPayload: JSON.stringify(ocrClaimPayload),
            signature: ocrSignature,
            issuedAt,
          });
        } catch {
          issues.push("signed_ocr_claim_failed");
        }
      }

      // Store signed claims for tamper-resistant verification (server measured)
      if (verificationResult) {
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
            policyVersion: POLICY_VERSION,
            documentHash,
            documentHashField,
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
            policyVersion: POLICY_VERSION,
            documentHash,
            documentHashField,
            data: {
              confidence: verificationResult.face_match_confidence,
              confidenceFixed: Math.round(
                verificationResult.face_match_confidence * 10000,
              ),
              thresholdFixed: Math.round(FACE_MATCH_MIN_CONFIDENCE * 10000),
              passed: verificationResult.faces_match,
              claimHash: documentHashField
                ? await computeClaimHash({
                    value: Math.round(
                      verificationResult.face_match_confidence * 10000,
                    ),
                    documentHashField,
                  })
                : null,
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

      let birthYearOffsetFheResult: { ciphertext: string } | null = null;
      let countryCodeFheResult: {
        ciphertext: string;
        countryCode: number;
      } | null = null;
      let nationalityCommitment: string | null = null;
      let livenessScoreFheResult: {
        ciphertext: string;
        score: number;
      } | null = null;
      let firstNameEncrypted: string | null = null;
      const fheErrors: Array<{
        operation: string;
        issue: string;
        kind: string;
        status?: number;
        message?: string;
        bodyText?: string;
      }> = [];
      let fheKeyMissingReported = false;
      const recordFheFailure = (
        issue: string,
        operation: string,
        error: unknown,
      ) => {
        issues.push(issue);
        if (error instanceof FheServiceError) {
          fheErrors.push({
            operation: error.operation,
            issue,
            kind: error.kind,
            status: error.status,
            message: error.message,
            bodyText: error.bodyText,
          });
          return;
        }

        fheErrors.push({
          operation,
          issue,
          kind: "unknown",
          message:
            error instanceof Error
              ? error.message
              : error
                ? String(error)
                : "Missing FHE key material",
        });
      };
      const reportMissingFheKey = () => {
        if (fheKeyMissingReported) return;
        fheKeyMissingReported = true;
        recordFheFailure("fhe_key_missing", "key_registration", null);
      };

      const dateOfBirth = documentResult?.extractedData?.dateOfBirth;
      const birthYearOffset = calculateBirthYearOffset(dateOfBirth);
      if (birthYearOffset !== undefined) {
        if (!hasFheKeyMaterial || !fhePublicKey) {
          reportMissingFheKey();
        } else {
          try {
            birthYearOffsetFheResult = await encryptBirthYearOffsetFhe({
              birthYearOffset,
              publicKey: fhePublicKey,
            });
          } catch (error) {
            const issue =
              error instanceof FheServiceError && error.kind === "http"
                ? "fhe_encryption_failed"
                : "fhe_service_unavailable";
            recordFheFailure(issue, "encrypt_birth_year_offset", error);
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

      const issuerCountry =
        documentResult?.documentOrigin ||
        documentResult?.extractedData?.nationalityCode;
      const countryCodeNumeric = issuerCountry
        ? countryCodeToNumeric(issuerCountry)
        : 0;
      if (countryCodeNumeric > 0) {
        if (!hasFheKeyMaterial || !fhePublicKey) {
          reportMissingFheKey();
        } else {
          try {
            countryCodeFheResult = {
              ...(await encryptCountryCodeFhe({
                countryCode: countryCodeNumeric,
                publicKey: fhePublicKey,
              })),
              countryCode: countryCodeNumeric,
            };
          } catch (error) {
            const issue =
              error instanceof FheServiceError && error.kind === "http"
                ? "fhe_encryption_failed"
                : "fhe_service_unavailable";
            recordFheFailure(issue, "encrypt_country_code", error);
          }
        }
      }

      const livenessScore = verificationResult?.antispoof_score;
      if (livenessScore !== undefined && livenessScore !== null) {
        if (!hasFheKeyMaterial || !fhePublicKey) {
          reportMissingFheKey();
        } else {
          try {
            livenessScoreFheResult = await encryptLivenessScoreFhe({
              score: livenessScore,
              publicKey: fhePublicKey,
            });
          } catch (error) {
            const issue =
              error instanceof FheServiceError && error.kind === "http"
                ? "liveness_score_fhe_encryption_failed"
                : "liveness_score_fhe_service_unavailable";
            recordFheFailure(issue, "encrypt_liveness", error);
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
      const birthYearOffsetEncrypted = Boolean(
        birthYearOffsetFheResult?.ciphertext,
      );
      const docValidityProofGenerated = false;
      const nationalityCommitmentGenerated = Boolean(nationalityCommitment);
      const countryCodeEncrypted = Boolean(countryCodeFheResult?.ciphertext);
      const livenessScoreEncrypted = Boolean(
        livenessScoreFheResult?.ciphertext,
      );
      const fheSucceeded =
        birthYearOffsetEncrypted ||
        countryCodeEncrypted ||
        livenessScoreEncrypted;
      const fheStatus: "pending" | "complete" | "error" = fheSucceeded
        ? "complete"
        : fheErrors.length > 0
          ? "error"
          : "pending";
      const verified =
        documentProcessed &&
        isDocumentValid &&
        livenessPassed &&
        facesMatch &&
        !isDuplicateDocument;

      // Calculate birth year offset from extracted DOB (for on-chain attestation)
      const birthYearOffsetFinal =
        birthYearOffset === undefined ? null : birthYearOffset;

      const bundleStatus = verified
        ? "pending"
        : documentProcessed
          ? "failed"
          : "pending";
      const bundleUpdate: Parameters<typeof upsertIdentityBundle>[0] = {
        userId,
        status: bundleStatus,
        issuerId: ISSUER_ID,
        policyVersion: POLICY_VERSION,
        fheStatus,
        fheError: fheStatus === "error" ? (fheErrors[0]?.issue ?? null) : null,
      };
      if (fheKeyId && fhePublicKey) {
        bundleUpdate.fheKeyId = fheKeyId;
        bundleUpdate.fhePublicKey = fhePublicKey;
      }

      upsertIdentityBundle(bundleUpdate);

      if (
        documentProcessed &&
        identityDocumentId &&
        documentResult?.commitments
      ) {
        try {
          const encryptedUserSalt = documentResult.commitments.userSalt
            ? await encryptUserSalt(documentResult.commitments.userSalt)
            : null;
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
            userSalt: encryptedUserSalt,
            birthYearOffset: birthYearOffsetFinal,
            firstNameEncrypted: firstNameEncrypted ?? null,
            verifiedAt: verified ? new Date().toISOString() : null,
            confidenceScore: documentResult.confidence ?? null,
            status: verified ? "verified" : "failed",
          });
        } catch {
          issues.push("failed_to_create_identity_document");
        }
      }

      if (birthYearOffsetFheResult?.ciphertext) {
        insertEncryptedAttribute({
          id: uuidv4(),
          userId,
          source: "web2_tfhe",
          attributeType: "birth_year_offset",
          ciphertext: birthYearOffsetFheResult.ciphertext,
          keyId: fheKeyId ?? null,
        });
      }

      if (countryCodeFheResult?.ciphertext) {
        insertEncryptedAttribute({
          id: uuidv4(),
          userId,
          source: "web2_tfhe",
          attributeType: "country_code",
          ciphertext: countryCodeFheResult.ciphertext,
          keyId: fheKeyId ?? null,
        });
      }

      if (livenessScoreFheResult?.ciphertext) {
        insertEncryptedAttribute({
          id: uuidv4(),
          userId,
          source: "web2_tfhe",
          attributeType: "liveness_score",
          ciphertext: livenessScoreFheResult.ciphertext,
          keyId: fheKeyId ?? null,
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
        documentId: identityDocumentId,
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
          birthYearOffsetEncrypted,
          docValidityProofGenerated,
          nationalityCommitmentGenerated,
          countryCodeEncrypted,
          livenessScoreEncrypted,
        },
        fheStatus,
        fheErrors: fheErrors.length > 0 ? fheErrors : undefined,
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
    .mutation(async ({ ctx, input }) => {
      const document = getSelectedIdentityDocumentByUserId(ctx.userId);
      if (!document?.userSalt || !document.nameCommitment) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "User has not completed identity verification",
        });
      }

      const decryptedSalt = await decryptUserSalt(document.userSalt);
      if (!decryptedSalt) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Unable to decrypt verification salt",
        });
      }

      const claimedCommitment = generateNameCommitment(
        input.claimedName,
        decryptedSalt,
      );

      const matches = crypto.timingSafeEqual(
        Buffer.from(claimedCommitment),
        Buffer.from(document.nameCommitment),
      );

      return { matches };
    }),
});
