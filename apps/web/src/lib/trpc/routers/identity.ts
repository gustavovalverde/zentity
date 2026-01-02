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

import type { OcrProcessResult } from "@/lib/document/ocr-client";

import crypto from "node:crypto";

import { TRPCError } from "@trpc/server";
import { and, eq, sql } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import z from "zod";

import {
  computeClaimHash,
  getDocumentHashField,
} from "@/lib/attestation/claim-hash";
import { ISSUER_ID, POLICY_VERSION } from "@/lib/attestation/policy";
import { sha256CommitmentHex } from "@/lib/crypto/commitments";
import { encryptBatchFhe, FheServiceError } from "@/lib/crypto/fhe-client";
import {
  decryptUserSalt,
  encryptFirstName,
  encryptUserSalt,
} from "@/lib/crypto/pii-encryption";
import { signAttestationClaim } from "@/lib/crypto/signed-claims";
import { db } from "@/lib/db/connection";
import {
  getSessionFromCookie,
  updateWizardProgress,
  validateStepAccess,
} from "@/lib/db/onboarding-session";
import { updateUserName } from "@/lib/db/queries/auth";
import {
  insertEncryptedAttribute,
  insertSignedClaim,
} from "@/lib/db/queries/crypto";
import {
  createIdentityDocument,
  createIdentityVerificationJob,
  documentHashExists,
  getIdentityDraftById,
  getIdentityDraftBySessionId,
  getIdentityVerificationJobById,
  getLatestIdentityDocumentByUserId,
  getLatestIdentityVerificationJobForDraft,
  getSelectedIdentityDocumentByUserId,
  getVerificationStatus,
  updateIdentityDraft,
  updateIdentityVerificationJobStatus,
  upsertIdentityBundle,
  upsertIdentityDraft,
} from "@/lib/db/queries/identity";
import { identityVerificationJobs } from "@/lib/db/schema/identity";
import { processDocument } from "@/lib/document/document-ocr";
import { cropFaceRegion } from "@/lib/document/image-processing";
import { processDocumentOcr } from "@/lib/document/ocr-client";
import { calculateBirthYearOffset } from "@/lib/identity/birth-year";
import { countryCodeToNumeric } from "@/lib/identity/compliance";
import {
  getEmbeddingVector,
  getLargestFace,
  getLiveScore,
  getRealScore,
} from "@/lib/liveness/human-metrics";
import { detectFromBase64, getHumanServer } from "@/lib/liveness/human-server";
import {
  ANTISPOOF_LIVE_THRESHOLD,
  ANTISPOOF_REAL_THRESHOLD,
  FACE_MATCH_MIN_CONFIDENCE,
} from "@/lib/liveness/liveness-policy";
import { hashIdentifier, withSpan } from "@/lib/observability/telemetry";
import { buildDisplayName } from "@/lib/utils/name-utils";
import { getNationalityCode } from "@/lib/zk/nationality-data";

import { protectedProcedure, publicProcedure, router } from "../server";

/** Matches Unicode diacritical marks for name normalization */
const DIACRITICS_PATTERN = /[\u0300-\u036f]/g;

/** Matches a string containing only digits */
const DIGITS_ONLY_PATTERN = /^\d+$/;

/** Matches one or more whitespace characters for splitting names */
const WHITESPACE_PATTERN = /\s+/;

// Face match threshold aligned with policy (see liveness-policy).

// In-memory rate limiter (document OCR). Resets on server restart.
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 10;

let lastRateLimitCleanupTimeMs = 0;

function cleanupRateLimitMap(now: number): void {
  if (now - lastRateLimitCleanupTimeMs < RATE_LIMIT_WINDOW_MS) {
    return;
  }
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

  if (record.count >= RATE_LIMIT_MAX_REQUESTS) {
    return true;
  }
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
    .replace(DIACRITICS_PATTERN, "")
    .toUpperCase()
    .split(WHITESPACE_PATTERN)
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
  if (!dateValue) {
    return null;
  }
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
  if (!dateValue) {
    return null;
  }
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
        return year * 10_000 + month * 100 + day;
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
        return year * 10_000 + month * 100 + day;
      }
    }
  }
  if (dateValue.length === 8 && DIGITS_ONLY_PATTERN.test(dateValue)) {
    const year = Number.parseInt(dateValue.slice(0, 4), 10);
    const month = Number.parseInt(dateValue.slice(4, 6), 10);
    const day = Number.parseInt(dateValue.slice(6, 8), 10);
    if (
      Number.isFinite(year) &&
      Number.isFinite(month) &&
      Number.isFinite(day)
    ) {
      return year * 10_000 + month * 100 + day;
    }
  }
  return null;
}

const activeIdentityJobs = new Set<string>();

function scheduleIdentityJob(jobId: string): void {
  if (activeIdentityJobs.has(jobId)) {
    return;
  }
  activeIdentityJobs.add(jobId);
  setTimeout(() => {
    processIdentityVerificationJob(jobId)
      .finally(() => {
        activeIdentityJobs.delete(jobId);
      })
      .catch(() => {
        // Error logged above; prevents unhandled rejection
      });
  }, 0);
}

function processIdentityVerificationJob(jobId: string): Promise<void> {
  return withSpan(
    "identity.finalize_job",
    {
      "identity.job_id_hash": hashIdentifier(jobId),
    },
    async (span) => {
      const claimTime = new Date().toISOString();
      db.update(identityVerificationJobs)
        .set({
          status: "running",
          startedAt: claimTime,
          attempts: sql`${identityVerificationJobs.attempts} + 1`,
          updatedAt: sql`datetime('now')`,
        })
        .where(
          and(
            eq(identityVerificationJobs.id, jobId),
            eq(identityVerificationJobs.status, "queued")
          )
        )
        .run();

      const job = getIdentityVerificationJobById(jobId);
      if (!job || job.status !== "running" || job.startedAt !== claimTime) {
        span.setAttribute("identity.job_skipped", true);
        return;
      }

      span.setAttribute("identity.job_id", job.id);
      span.setAttribute("identity.user_id_hash", hashIdentifier(job.userId));
      span.setAttribute("identity.draft_id_hash", hashIdentifier(job.draftId));
      span.setAttribute("identity.fhe_key_present", Boolean(job.fheKeyId));

      const startTime = Date.now();
      const issues: string[] = [];

      try {
        const draft = getIdentityDraftById(job.draftId);
        if (!draft) {
          updateIdentityVerificationJobStatus({
            jobId,
            status: "error",
            error: "Identity draft not found",
            finishedAt: new Date().toISOString(),
          });
          span.setAttribute("identity.draft_missing", true);
          return;
        }

        if (!draft.userId) {
          updateIdentityDraft(draft.id, { userId: job.userId });
        }

        const documentProcessed = Boolean(draft.documentProcessed);
        const isDocumentValid = Boolean(draft.isDocumentValid);
        const isDuplicateDocument = Boolean(draft.isDuplicateDocument);
        const livenessPassed = Boolean(draft.livenessPassed);
        const faceMatchPassed = Boolean(draft.faceMatchPassed);

        span.setAttribute("identity.document_processed", documentProcessed);
        span.setAttribute("identity.document_valid", isDocumentValid);
        span.setAttribute("identity.document_duplicate", isDuplicateDocument);
        span.setAttribute("identity.liveness_passed", livenessPassed);
        span.setAttribute("identity.face_match_passed", faceMatchPassed);

        if (!documentProcessed) {
          issues.push("document_processing_failed");
        }
        if (documentProcessed && !isDocumentValid) {
          issues.push("document_invalid");
        }
        if (isDuplicateDocument) {
          issues.push("duplicate_document");
        }
        if (!livenessPassed) {
          issues.push("liveness_failed");
        }
        if (!faceMatchPassed) {
          issues.push("face_match_failed");
        }

        const documentHash = draft.documentHash ?? null;
        let documentHashField = draft.documentHashField ?? null;
        if (!documentHashField && documentHash) {
          try {
            documentHashField = await getDocumentHashField(documentHash);
            updateIdentityDraft(draft.id, { documentHashField });
          } catch {
            issues.push("document_hash_field_failed");
          }
        }

        const issuedAt = new Date().toISOString();
        const claimHashes: {
          age?: string | null;
          docValidity?: string | null;
          nationality?: string | null;
        } = {
          age: null,
          docValidity: null,
          nationality: null,
        };

        if (documentProcessed && documentHash && documentHashField) {
          try {
            const birthYear = draft.birthYear ?? null;
            const expiryDate = draft.expiryDateInt ?? null;
            const nationalityCode = draft.nationalityCode ?? null;
            const nationalityCodeNumeric = draft.nationalityCodeNumeric ?? null;

            if (birthYear !== null) {
              claimHashes.age = await computeClaimHash({
                value: birthYear,
                documentHashField,
              });
            }
            if (expiryDate !== null) {
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
              userId: job.userId,
              issuedAt,
              version: 1,
              policyVersion: POLICY_VERSION,
              documentHash,
              documentHashField,
              data: {
                documentType: draft.documentType ?? null,
                issuerCountry: draft.issuerCountry ?? null,
                nationalityCode,
                nationalityCodeNumeric,
                expiryDate,
                birthYear,
                confidence: draft.confidenceScore ?? null,
                claimHashes,
              },
            };

            const ocrSignature = await signAttestationClaim(ocrClaimPayload);
            insertSignedClaim({
              id: uuidv4(),
              userId: job.userId,
              documentId: draft.documentId,
              claimType: ocrClaimPayload.type,
              claimPayload: JSON.stringify(ocrClaimPayload),
              signature: ocrSignature,
              issuedAt,
            });
          } catch {
            issues.push("signed_ocr_claim_failed");
          }
        }

        if (
          typeof draft.antispoofScore === "number" &&
          typeof draft.liveScore === "number"
        ) {
          try {
            const antispoofScoreFixed = Math.round(
              draft.antispoofScore * 10_000
            );
            const liveScoreFixed = Math.round(draft.liveScore * 10_000);

            const livenessClaimPayload = {
              type: "liveness_score" as const,
              userId: job.userId,
              issuedAt,
              version: 1,
              policyVersion: POLICY_VERSION,
              documentHash,
              documentHashField,
              data: {
                antispoofScore: draft.antispoofScore,
                liveScore: draft.liveScore,
                passed: livenessPassed,
                antispoofScoreFixed,
                liveScoreFixed,
              },
            };

            const livenessSignature =
              await signAttestationClaim(livenessClaimPayload);
            insertSignedClaim({
              id: uuidv4(),
              userId: job.userId,
              documentId: draft.documentId,
              claimType: livenessClaimPayload.type,
              claimPayload: JSON.stringify(livenessClaimPayload),
              signature: livenessSignature,
              issuedAt,
            });
          } catch {
            issues.push("signed_liveness_claim_failed");
          }
        }

        if (
          typeof draft.faceMatchConfidence === "number" &&
          documentHashField
        ) {
          try {
            const confidenceFixed = Math.round(
              draft.faceMatchConfidence * 10_000
            );
            const thresholdFixed = Math.round(
              FACE_MATCH_MIN_CONFIDENCE * 10_000
            );
            const claimHash = await computeClaimHash({
              value: confidenceFixed,
              documentHashField,
            });

            const faceMatchClaimPayload = {
              type: "face_match_score" as const,
              userId: job.userId,
              issuedAt,
              version: 1,
              policyVersion: POLICY_VERSION,
              documentHash,
              documentHashField,
              data: {
                confidence: draft.faceMatchConfidence,
                confidenceFixed,
                thresholdFixed,
                passed: faceMatchPassed,
                claimHash,
              },
            };

            const faceMatchSignature = await signAttestationClaim(
              faceMatchClaimPayload
            );
            insertSignedClaim({
              id: uuidv4(),
              userId: job.userId,
              documentId: draft.documentId,
              claimType: faceMatchClaimPayload.type,
              claimPayload: JSON.stringify(faceMatchClaimPayload),
              signature: faceMatchSignature,
              issuedAt,
            });
          } catch {
            issues.push("signed_face_match_claim_failed");
          }
        }

        let birthYearOffsetFheResult: { ciphertext: string } | null = null;
        let countryCodeFheResult: {
          ciphertext: string;
          countryCode: number;
        } | null = null;
        let livenessScoreFheResult: {
          ciphertext: string;
          score: number;
        } | null = null;
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
          error: unknown
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

          let errorMessage = "Missing FHE key material";
          if (error instanceof Error) {
            errorMessage = error.message;
          } else if (error) {
            errorMessage = String(error);
          }
          fheErrors.push({
            operation,
            issue,
            kind: "unknown",
            message: errorMessage,
          });
        };

        const reportMissingFheKey = () => {
          if (fheKeyMissingReported) {
            return;
          }
          fheKeyMissingReported = true;
          recordFheFailure("fhe_key_missing", "key_registration", null);
        };

        const hasFheKeyMaterial = Boolean(job.fheKeyId);
        const birthYearOffset = draft.birthYearOffset;
        const countryCodeNumeric = draft.countryCodeNumeric ?? 0;
        const livenessScore = draft.antispoofScore;
        const needsEncryption =
          (birthYearOffset !== null && birthYearOffset !== undefined) ||
          countryCodeNumeric > 0 ||
          typeof livenessScore === "number";

        if (needsEncryption) {
          if (hasFheKeyMaterial && job.fheKeyId) {
            try {
              const batchResult = await encryptBatchFhe({
                keyId: job.fheKeyId,
                birthYearOffset:
                  birthYearOffset !== null && birthYearOffset !== undefined
                    ? birthYearOffset
                    : undefined,
                countryCode:
                  countryCodeNumeric > 0 ? countryCodeNumeric : undefined,
                livenessScore:
                  typeof livenessScore === "number" ? livenessScore : undefined,
                requestId: job.id,
              });

              if (batchResult.birthYearOffsetCiphertext) {
                birthYearOffsetFheResult = {
                  ciphertext: batchResult.birthYearOffsetCiphertext,
                };
              }

              if (batchResult.countryCodeCiphertext) {
                countryCodeFheResult = {
                  ciphertext: batchResult.countryCodeCiphertext,
                  countryCode: countryCodeNumeric,
                };
              }

              if (
                batchResult.livenessScoreCiphertext &&
                typeof livenessScore === "number"
              ) {
                livenessScoreFheResult = {
                  ciphertext: batchResult.livenessScoreCiphertext,
                  score: livenessScore,
                };
              }
            } catch (error) {
              const isHttp =
                error instanceof FheServiceError && error.kind === "http";
              if (birthYearOffset !== null && birthYearOffset !== undefined) {
                recordFheFailure(
                  isHttp ? "fhe_encryption_failed" : "fhe_service_unavailable",
                  "encrypt_birth_year_offset",
                  error
                );
              }
              if (countryCodeNumeric > 0) {
                recordFheFailure(
                  isHttp ? "fhe_encryption_failed" : "fhe_service_unavailable",
                  "encrypt_country_code",
                  error
                );
              }
              if (typeof livenessScore === "number") {
                recordFheFailure(
                  isHttp
                    ? "liveness_score_fhe_encryption_failed"
                    : "liveness_score_fhe_service_unavailable",
                  "encrypt_liveness",
                  error
                );
              }
            }
          } else {
            reportMissingFheKey();
          }
        }

        const birthYearOffsetEncrypted = Boolean(
          birthYearOffsetFheResult?.ciphertext
        );
        const countryCodeEncrypted = Boolean(countryCodeFheResult?.ciphertext);
        const livenessScoreEncrypted = Boolean(
          livenessScoreFheResult?.ciphertext
        );
        const fheSucceeded =
          birthYearOffsetEncrypted ||
          countryCodeEncrypted ||
          livenessScoreEncrypted;
        const fheStatus = ((): "pending" | "complete" | "error" => {
          if (fheSucceeded) {
            return "complete";
          }
          if (fheErrors.length > 0) {
            return "error";
          }
          return "pending";
        })();

        const verified =
          documentProcessed &&
          isDocumentValid &&
          livenessPassed &&
          faceMatchPassed &&
          !isDuplicateDocument;

        const bundleStatus = ((): "pending" | "verified" | "failed" => {
          if (verified) {
            return "pending";
          }
          if (documentProcessed) {
            return "failed";
          }
          return "pending";
        })();
        const bundleUpdate: Parameters<typeof upsertIdentityBundle>[0] = {
          userId: job.userId,
          status: bundleStatus,
          issuerId: ISSUER_ID,
          policyVersion: POLICY_VERSION,
          fheStatus,
          fheError:
            fheStatus === "error" ? (fheErrors[0]?.issue ?? null) : null,
        };
        if (job.fheKeyId) {
          bundleUpdate.fheKeyId = job.fheKeyId;
        }

        upsertIdentityBundle(bundleUpdate);

        if (documentProcessed && draft.documentId) {
          try {
            createIdentityDocument({
              id: draft.documentId,
              userId: job.userId,
              documentType: draft.documentType ?? null,
              issuerCountry: draft.issuerCountry ?? null,
              documentHash: isDuplicateDocument
                ? null
                : (draft.documentHash ?? null),
              nameCommitment: draft.nameCommitment ?? null,
              userSalt: draft.userSalt ?? null,
              birthYearOffset: draft.birthYearOffset ?? null,
              firstNameEncrypted: draft.firstNameEncrypted ?? null,
              verifiedAt: verified ? new Date().toISOString() : null,
              confidenceScore: draft.confidenceScore ?? null,
              status: verified ? "verified" : "failed",
            });
          } catch {
            issues.push("failed_to_create_identity_document");
          }
        }

        if (birthYearOffsetFheResult?.ciphertext) {
          insertEncryptedAttribute({
            id: uuidv4(),
            userId: job.userId,
            source: "web2_tfhe",
            attributeType: "birth_year_offset",
            ciphertext: birthYearOffsetFheResult.ciphertext,
            keyId: job.fheKeyId ?? null,
          });
        }

        if (countryCodeFheResult?.ciphertext) {
          insertEncryptedAttribute({
            id: uuidv4(),
            userId: job.userId,
            source: "web2_tfhe",
            attributeType: "country_code",
            ciphertext: countryCodeFheResult.ciphertext,
            keyId: job.fheKeyId ?? null,
          });
        }

        if (livenessScoreFheResult?.ciphertext) {
          insertEncryptedAttribute({
            id: uuidv4(),
            userId: job.userId,
            source: "web2_tfhe",
            attributeType: "liveness_score",
            ciphertext: livenessScoreFheResult.ciphertext,
            keyId: job.fheKeyId ?? null,
          });
        }

        const resultPayload = {
          success: true,
          verified,
          documentId: draft.documentId,
          results: {
            documentProcessed,
            documentType: draft.documentType ?? undefined,
            documentOrigin: draft.issuerCountry ?? undefined,
            isDocumentValid,
            livenessPassed,
            faceMatched: faceMatchPassed,
            isDuplicateDocument,
            ageProofGenerated: false,
            birthYearOffsetEncrypted,
            docValidityProofGenerated: false,
            nationalityCommitmentGenerated:
              (draft.nationalityCode ?? null) !== null,
            countryCodeEncrypted,
            livenessScoreEncrypted,
          },
          fheStatus,
          fheErrors: fheErrors.length > 0 ? fheErrors : undefined,
          processingTimeMs: Date.now() - startTime,
          issues,
        };

        updateIdentityVerificationJobStatus({
          jobId,
          status: "complete",
          result: JSON.stringify(resultPayload),
          finishedAt: new Date().toISOString(),
        });

        span.setAttribute("identity.verified", verified);
        span.setAttribute("identity.fhe_status", fheStatus);
        span.setAttribute("identity.issue_count", issues.length);
        span.setAttribute("identity.processing_ms", Date.now() - startTime);
      } catch (error) {
        updateIdentityVerificationJobStatus({
          jobId,
          status: "error",
          error: error instanceof Error ? error.message : "Job failed",
          finishedAt: new Date().toISOString(),
        });
        span.setAttribute("identity.job_error", true);
      }
    }
  );
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

      ctx.span?.setAttribute(
        "onboarding.document_image_bytes",
        Buffer.byteLength(input.image)
      );

      try {
        return await processDocument(input.image, ctx.requestId);
      } catch (error) {
        if (
          error instanceof Error &&
          (error.message.includes("ECONNREFUSED") ||
            error.message.includes("fetch failed"))
        ) {
          throw new TRPCError({
            code: "SERVICE_UNAVAILABLE",
            message:
              "Document processing service unavailable. Please try again later.",
          });
        }

        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to process document. Please try a clearer image.",
        });
      }
    }),
  /**
   * OCR + draft creation for onboarding.
   *
   * Performs document OCR, computes commitments, and persists a draft that can be
   * finalized later once the user account exists.
   */
  prepareDocument: publicProcedure
    .input(z.object({ image: z.string().min(1, "Image is required") }))
    .mutation(async ({ ctx, input }) => {
      const session = await getSessionFromCookie();
      const validation = validateStepAccess(session, "process-document");
      if (!(validation.valid && validation.session)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: validation.error || "Session required",
        });
      }

      ctx.span?.setAttribute(
        "onboarding.document_image_bytes",
        Buffer.byteLength(input.image)
      );

      let documentResult: OcrProcessResult | null = null;
      const issues: string[] = [];

      try {
        documentResult = await processDocumentOcr({
          image: input.image,
          requestId: ctx.requestId,
        });
        issues.push(...(documentResult?.validationIssues || []));
      } catch {
        issues.push("document_processing_failed");
      }

      const sessionId = validation.session.id;
      const existingDraft =
        validation.session.identityDraftId !== null &&
        validation.session.identityDraftId !== undefined
          ? getIdentityDraftById(validation.session.identityDraftId)
          : getIdentityDraftBySessionId(sessionId);

      const draftId = existingDraft?.id ?? uuidv4();
      const documentId = existingDraft?.documentId ?? uuidv4();

      const documentProcessed = Boolean(documentResult?.commitments);
      const documentHash = documentResult?.commitments?.documentHash ?? null;
      let documentHashField: string | null = null;
      if (documentHash) {
        try {
          documentHashField = await getDocumentHashField(documentHash);
        } catch {
          issues.push("document_hash_field_failed");
        }
      }

      let isDuplicateDocument = false;
      if (documentHash) {
        const hashExists = documentHashExists(documentHash);
        if (hashExists) {
          isDuplicateDocument = true;
          issues.push("duplicate_document");
        }
      }

      const birthYear = parseBirthYear(
        documentResult?.extractedData?.dateOfBirth
      );
      const expiryDateInt = parseDateToInt(
        documentResult?.extractedData?.expirationDate
      );
      const birthYearOffset = calculateBirthYearOffset(
        documentResult?.extractedData?.dateOfBirth
      );

      const nationalityCode =
        documentResult?.extractedData?.nationalityCode ?? null;
      const nationalityCodeNumeric = nationalityCode
        ? (getNationalityCode(nationalityCode) ?? null)
        : null;
      const issuerCountry =
        documentResult?.documentOrigin ||
        documentResult?.extractedData?.nationalityCode ||
        null;
      const countryCodeNumeric = issuerCountry
        ? countryCodeToNumeric(issuerCountry)
        : 0;

      let firstNameEncrypted: string | null = null;
      const firstName = documentResult?.extractedData?.firstName;
      if (firstName) {
        try {
          firstNameEncrypted = await encryptFirstName(firstName);
        } catch {
          issues.push("first_name_encryption_failed");
        }
      }

      const encryptedUserSalt = documentResult?.commitments?.userSalt
        ? await encryptUserSalt(documentResult.commitments.userSalt)
        : null;

      const isDocumentValid =
        documentProcessed &&
        (documentResult?.confidence ?? 0) > 0.3 &&
        Boolean(documentResult?.extractedData?.documentNumber);

      ctx.span?.setAttribute(
        "onboarding.document_processed",
        documentProcessed
      );
      ctx.span?.setAttribute("onboarding.document_valid", isDocumentValid);
      ctx.span?.setAttribute(
        "onboarding.document_duplicate",
        isDuplicateDocument
      );
      ctx.span?.setAttribute("onboarding.issues_count", issues.length);

      upsertIdentityDraft({
        id: draftId,
        onboardingSessionId: sessionId,
        documentId,
        documentProcessed,
        isDocumentValid,
        isDuplicateDocument,
        documentType: documentResult?.documentType ?? null,
        issuerCountry,
        documentHash,
        documentHashField,
        nameCommitment: documentResult?.commitments?.nameCommitment ?? null,
        userSalt: encryptedUserSalt,
        birthYear,
        birthYearOffset:
          birthYearOffset === undefined ? null : (birthYearOffset ?? null),
        expiryDateInt,
        nationalityCode,
        nationalityCodeNumeric,
        countryCodeNumeric: countryCodeNumeric > 0 ? countryCodeNumeric : null,
        confidenceScore: documentResult?.confidence ?? null,
        firstNameEncrypted,
        ocrIssues: issues.length ? JSON.stringify(issues) : null,
      });

      await updateWizardProgress(validation.session.id, {
        documentProcessed: isDocumentValid,
        documentHash: documentHash ?? undefined,
        identityDraftId: draftId,
        step: Math.max(validation.session.step ?? 1, 2),
      });

      return {
        success: true,
        draftId,
        documentId,
        documentProcessed,
        isDocumentValid,
        isDuplicateDocument,
        issues,
        documentResult: documentResult
          ? {
              documentType: documentResult.documentType,
              documentOrigin: documentResult.documentOrigin,
              confidence: documentResult.confidence,
              extractedData: documentResult.extractedData,
              validationIssues: documentResult.validationIssues,
            }
          : {
              documentType: "unknown",
              confidence: 0,
              validationIssues: ["document_processing_failed"],
            },
      };
    }),
  /** Returns the current verification status for the authenticated user. */
  status: protectedProcedure.query(({ ctx }) =>
    getVerificationStatus(ctx.userId)
  ),

  /**
   * Precompute liveness + face match and persist to the identity draft.
   * Runs after liveness challenges are complete (or skipped).
   */
  prepareLiveness: publicProcedure
    .input(
      z.object({
        draftId: z.string().min(1),
        documentImage: z.string().min(1),
        selfieImage: z.string().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const startTime = Date.now();
      const issues: string[] = [];

      const onboardingSession = await getSessionFromCookie();
      const stepValidation = validateStepAccess(
        onboardingSession,
        "face-match"
      );
      if (!(stepValidation.valid && stepValidation.session)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: stepValidation.error || "Complete previous steps first",
        });
      }

      ctx.span?.setAttribute(
        "onboarding.document_image_bytes",
        Buffer.byteLength(input.documentImage)
      );
      ctx.span?.setAttribute(
        "onboarding.selfie_image_bytes",
        Buffer.byteLength(input.selfieImage)
      );
      ctx.span?.setAttribute(
        "onboarding.draft_id_hash",
        hashIdentifier(input.draftId)
      );

      if (
        stepValidation.session.identityDraftId &&
        stepValidation.session.identityDraftId !== input.draftId
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Identity draft mismatch. Please restart verification.",
        });
      }

      const draft = getIdentityDraftById(input.draftId);
      if (!draft) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Identity draft not found",
        });
      }

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
              box
            );
            docResult = await detectFromBase64(croppedFaceDataUrl);
          } catch {
            /* Crop failed, fallback to initial detection result */
          }
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

        issues.push(...localIssues);
      } catch {
        issues.push("verification_service_failed");
      }

      const livenessPassed = livenessPassedLocal;
      const faceMatchPassed = facesMatchLocal;

      updateIdentityDraft(draft.id, {
        antispoofScore,
        liveScore,
        livenessPassed,
        faceMatchConfidence,
        faceMatchPassed,
      });

      await updateWizardProgress(stepValidation.session.id, {
        livenessPassed,
        faceMatchPassed,
        step: Math.max(stepValidation.session.step ?? 1, 3),
      });

      ctx.span?.setAttribute("onboarding.liveness_passed", livenessPassed);
      ctx.span?.setAttribute("onboarding.face_match_passed", faceMatchPassed);
      ctx.span?.setAttribute(
        "onboarding.face_match_confidence",
        faceMatchConfidence
      );
      ctx.span?.setAttribute("onboarding.issues_count", issues.length);
      ctx.span?.setAttribute(
        "onboarding.processing_ms",
        Date.now() - startTime
      );

      return {
        success: true,
        livenessPassed,
        faceMatchPassed,
        faceMatchConfidence,
        processingTimeMs: Date.now() - startTime,
        issues,
      };
    }),

  /**
   * Enqueue identity finalization (FHE + signed claims) as a DB-backed job.
   */
  finalizeAsync: protectedProcedure
    .input(
      z.object({
        draftId: z.string().min(1),
        fheKeyId: z.string().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const onboardingSession = await getSessionFromCookie();
      const stepValidation = validateStepAccess(
        onboardingSession,
        "identity-finalize"
      );
      if (!(stepValidation.valid && stepValidation.session)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: stepValidation.error || "Complete previous steps first",
        });
      }

      ctx.span?.setAttribute(
        "onboarding.draft_id_hash",
        hashIdentifier(input.draftId)
      );
      ctx.span?.setAttribute("fhe.key_id_hash", hashIdentifier(input.fheKeyId));

      if (
        stepValidation.session.identityDraftId &&
        stepValidation.session.identityDraftId !== input.draftId
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Identity draft mismatch. Please restart verification.",
        });
      }

      const draft = getIdentityDraftById(input.draftId);
      if (!draft) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Identity draft not found",
        });
      }

      const existingJob = getLatestIdentityVerificationJobForDraft(
        input.draftId
      );
      if (
        existingJob &&
        existingJob.status !== "error" &&
        existingJob.status !== "complete"
      ) {
        scheduleIdentityJob(existingJob.id);
        return { jobId: existingJob.id, status: existingJob.status };
      }

      const jobId = uuidv4();
      createIdentityVerificationJob({
        id: jobId,
        draftId: input.draftId,
        userId: ctx.userId,
        fheKeyId: input.fheKeyId,
      });

      scheduleIdentityJob(jobId);

      return { jobId, status: "queued" };
    }),

  /**
   * Check status for an identity finalization job.
   */
  finalizeStatus: protectedProcedure
    .input(z.object({ jobId: z.string().min(1) }))
    .query(({ input }) => {
      const job = getIdentityVerificationJobById(input.jobId);
      if (!job) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Job not found",
        });
      }

      if (job.status === "queued") {
        scheduleIdentityJob(job.id);
      }

      let result: VerifyIdentityResponse | null = null;
      if (job.result) {
        try {
          result = JSON.parse(job.result) as VerifyIdentityResponse;
        } catch {
          result = null;
        }
      }

      return {
        jobId: job.id,
        status: job.status,
        result,
        error: job.error ?? undefined,
        startedAt: job.startedAt ?? undefined,
        finishedAt: job.finishedAt ?? undefined,
      };
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
        fheKeyId: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const startTime = Date.now();
      const issues: string[] = [];

      const onboardingSession = await getSessionFromCookie();
      const stepValidation = validateStepAccess(
        onboardingSession,
        "identity-verify"
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
      const fheKeyId = input.fheKeyId;
      const hasFheKeyMaterial = Boolean(fheKeyId);

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
          documentResult.commitments.documentHash
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
              box
            );
            docResult = await detectFromBase64(croppedFaceDataUrl);
          } catch {
            /* Crop failed, fallback to initial detection result */
          }
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
        /* Human.js detection failed, add to issues */
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
            documentResult?.extractedData?.dateOfBirth
          );
          const expiryDate = parseDateToInt(
            documentResult?.extractedData?.expirationDate
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
          verificationResult.antispoof_score * 10_000
        );
        const liveScoreFixed = Math.round(liveScore * 10_000);

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
                verificationResult.face_match_confidence * 10_000
              ),
              thresholdFixed: Math.round(FACE_MATCH_MIN_CONFIDENCE * 10_000),
              passed: verificationResult.faces_match,
              claimHash: documentHashField
                ? await computeClaimHash({
                    value: Math.round(
                      verificationResult.face_match_confidence * 10_000
                    ),
                    documentHashField,
                  })
                : null,
            },
          };

          const faceMatchSignature = await signAttestationClaim(
            faceMatchClaimPayload
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
        error: unknown
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

        let errorMessage = "Missing FHE key material";
        if (error instanceof Error) {
          errorMessage = error.message;
        } else if (error) {
          errorMessage = String(error);
        }
        fheErrors.push({
          operation,
          issue,
          kind: "unknown",
          message: errorMessage,
        });
      };
      const reportMissingFheKey = () => {
        if (fheKeyMissingReported) {
          return;
        }
        fheKeyMissingReported = true;
        recordFheFailure("fhe_key_missing", "key_registration", null);
      };

      const dateOfBirth = documentResult?.extractedData?.dateOfBirth;
      const birthYearOffset = calculateBirthYearOffset(dateOfBirth);

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
      const livenessScore = verificationResult?.antispoof_score;
      const needsEncryption =
        birthYearOffset !== undefined ||
        countryCodeNumeric > 0 ||
        (livenessScore !== undefined && livenessScore !== null);

      if (needsEncryption) {
        if (hasFheKeyMaterial && fheKeyId) {
          try {
            const batchResult = await encryptBatchFhe({
              keyId: fheKeyId,
              birthYearOffset,
              countryCode:
                countryCodeNumeric > 0 ? countryCodeNumeric : undefined,
              livenessScore:
                livenessScore !== undefined && livenessScore !== null
                  ? livenessScore
                  : undefined,
              requestId: ctx.requestId,
            });

            if (batchResult.birthYearOffsetCiphertext) {
              birthYearOffsetFheResult = {
                ciphertext: batchResult.birthYearOffsetCiphertext,
              };
            }

            if (batchResult.countryCodeCiphertext) {
              countryCodeFheResult = {
                ciphertext: batchResult.countryCodeCiphertext,
                countryCode: countryCodeNumeric,
              };
            }

            if (
              batchResult.livenessScoreCiphertext &&
              livenessScore !== undefined &&
              livenessScore !== null
            ) {
              livenessScoreFheResult = {
                ciphertext: batchResult.livenessScoreCiphertext,
                score: livenessScore,
              };
            }
          } catch (error) {
            const isHttp =
              error instanceof FheServiceError && error.kind === "http";
            if (birthYearOffset !== undefined) {
              recordFheFailure(
                isHttp ? "fhe_encryption_failed" : "fhe_service_unavailable",
                "encrypt_birth_year_offset",
                error
              );
            }
            if (countryCodeNumeric > 0) {
              recordFheFailure(
                isHttp ? "fhe_encryption_failed" : "fhe_service_unavailable",
                "encrypt_country_code",
                error
              );
            }
            if (livenessScore !== undefined && livenessScore !== null) {
              recordFheFailure(
                isHttp
                  ? "liveness_score_fhe_encryption_failed"
                  : "liveness_score_fhe_service_unavailable",
                "encrypt_liveness",
                error
              );
            }
          }
        } else {
          reportMissingFheKey();
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
        birthYearOffsetFheResult?.ciphertext
      );
      const docValidityProofGenerated = false;
      const nationalityCommitmentGenerated = Boolean(nationalityCommitment);
      const countryCodeEncrypted = Boolean(countryCodeFheResult?.ciphertext);
      const livenessScoreEncrypted = Boolean(
        livenessScoreFheResult?.ciphertext
      );
      const fheSucceeded =
        birthYearOffsetEncrypted ||
        countryCodeEncrypted ||
        livenessScoreEncrypted;
      const fheStatus = ((): "pending" | "complete" | "error" => {
        if (fheSucceeded) {
          return "complete";
        }
        if (fheErrors.length > 0) {
          return "error";
        }
        return "pending";
      })();
      const verified =
        documentProcessed &&
        isDocumentValid &&
        livenessPassed &&
        facesMatch &&
        !isDuplicateDocument;

      // Calculate birth year offset from extracted DOB (for on-chain attestation)
      const birthYearOffsetFinal =
        birthYearOffset === undefined ? null : birthYearOffset;

      const bundleStatus = ((): "pending" | "verified" | "failed" => {
        if (verified) {
          return "pending";
        }
        if (documentProcessed) {
          return "failed";
        }
        return "pending";
      })();
      const bundleUpdate: Parameters<typeof upsertIdentityBundle>[0] = {
        userId,
        status: bundleStatus,
        issuerId: ISSUER_ID,
        policyVersion: POLICY_VERSION,
        fheStatus,
        fheError: fheStatus === "error" ? (fheErrors[0]?.issue ?? null) : null,
      };
      if (fheKeyId) {
        bundleUpdate.fheKeyId = fheKeyId;
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
            documentResult.extractedData.lastName
          );
          if (displayName) {
            updateUserName(userId, displayName);
          }
        } catch {
          /* Name update failed, non-critical for verification */
        }
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
      })
    )
    .mutation(async ({ ctx, input }) => {
      const document = getSelectedIdentityDocumentByUserId(ctx.userId);
      if (!(document?.userSalt && document.nameCommitment)) {
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
        decryptedSalt
      );

      const matches = crypto.timingSafeEqual(
        Buffer.from(claimedCommitment),
        Buffer.from(document.nameCommitment)
      );

      return { matches };
    }),
});
