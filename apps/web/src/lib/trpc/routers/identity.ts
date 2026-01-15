/**
 * Identity Router
 *
 * Orchestrates the full identity verification flow:
 * 1. Document OCR + commitment generation (privacy-preserving hashes)
 * 2. Face detection on selfie with anti-spoofing checks
 * 3. Face matching between document photo and selfie
 * 4. Queue FHE encryption of sensitive fields (birth year offset, country code, liveness score)
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
import { revalidateTag, unstable_cache } from "next/cache";
import { v4 as uuidv4 } from "uuid";
import z from "zod";

import {
  computeClaimHash,
  getDocumentHashField,
} from "@/lib/attestation/claim-hash";
import { ISSUER_ID, POLICY_VERSION } from "@/lib/attestation/policy";
import { sha256CommitmentHex } from "@/lib/crypto/commitments";
import { scheduleFheEncryption } from "@/lib/crypto/fhe-encryption";
import { signAttestationClaim } from "@/lib/crypto/signed-claims";
import { db } from "@/lib/db/connection";
import {
  getSessionFromCookie,
  updateWizardProgress,
  validateStepAccess,
} from "@/lib/db/onboarding-session";
import { insertSignedClaim } from "@/lib/db/queries/crypto";
import {
  createIdentityDocument,
  createIdentityVerificationJob,
  documentHashExists,
  getIdentityBundleByUserId,
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
import { processDocumentOcr } from "@/lib/document/ocr-client";
import { calculateBirthYearOffset } from "@/lib/identity/birth-year";
import {
  computeClaimHashes,
  storeVerificationClaims,
} from "@/lib/identity/claims-signing";
import { countryCodeToNumeric } from "@/lib/identity/compliance";
import { validateFaces } from "@/lib/identity/face-validation";
import { FACE_MATCH_MIN_CONFIDENCE } from "@/lib/liveness/policy";
import { logger } from "@/lib/logging/logger";
import { hashIdentifier, withSpan } from "@/lib/observability/telemetry";
import { getNationalityCode } from "@/lib/zk/nationality-data";

import { protectedProcedure, publicProcedure, router } from "../server";

/**
 * Cached verification status with 5-minute TTL.
 * Uses unstable_cache with tag-based invalidation.
 */
function getCachedVerificationStatus(userId: string) {
  return unstable_cache(
    () => getVerificationStatus(userId),
    [`user-verification-${userId}`],
    {
      revalidate: 300, // 5-minute TTL
      tags: [`user-verification-${userId}`],
    }
  )();
}

/**
 * Invalidate cached verification status for a user.
 * Call this after successful verification or proof storage.
 * Uses 'max' profile for stale-while-revalidate behavior.
 */
export function invalidateVerificationCache(userId: string) {
  try {
    revalidateTag(`user-verification-${userId}`, "max");
  } catch {
    // Ignore when running outside Next.js request/route context (tests, scripts).
  }
}

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
const pendingFheInputs = new Map<
  string,
  { birthYearOffset?: number | null; countryCodeNumeric?: number | null }
>();

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
      await db
        .update(identityVerificationJobs)
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

      const job = await getIdentityVerificationJobById(jobId);
      if (!job || job.status !== "running" || job.startedAt !== claimTime) {
        span.setAttribute("identity.job_skipped", true);
        return;
      }

      const pendingInputs = pendingFheInputs.get(job.id);
      pendingFheInputs.delete(job.id);

      span.setAttribute("identity.job_id", job.id);
      span.setAttribute("identity.user_id_hash", hashIdentifier(job.userId));
      span.setAttribute("identity.draft_id_hash", hashIdentifier(job.draftId));
      span.setAttribute("identity.fhe_key_present", Boolean(job.fheKeyId));

      const startTime = Date.now();
      const issues: string[] = [];

      try {
        const draft = await getIdentityDraftById(job.draftId);
        if (!draft) {
          await updateIdentityVerificationJobStatus({
            jobId,
            status: "error",
            error: "Identity draft not found",
            finishedAt: new Date().toISOString(),
          });
          span.setAttribute("identity.draft_missing", true);
          return;
        }

        span.setAttribute(
          "onboarding.session_id_hash",
          hashIdentifier(draft.onboardingSessionId)
        );

        if (!draft.userId) {
          await updateIdentityDraft(draft.id, { userId: job.userId });
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
            await updateIdentityDraft(draft.id, { documentHashField });
          } catch (error) {
            logger.error(
              { error: String(error), jobId, documentHash },
              "Failed to generate document hash field in finalize job"
            );
            issues.push("document_hash_field_failed");
          }
        }

        const issuedAt = new Date().toISOString();
        if (documentProcessed && documentHash && documentHashField) {
          try {
            const claimHashes = {
              age: draft.ageClaimHash ?? null,
              docValidity: draft.docValidityClaimHash ?? null,
              nationality: draft.nationalityClaimHash ?? null,
            };

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
                confidence: draft.confidenceScore ?? null,
                claimHashes,
              },
            };

            const ocrSignature = await signAttestationClaim(ocrClaimPayload);
            await insertSignedClaim({
              id: uuidv4(),
              userId: job.userId,
              documentId: draft.documentId,
              claimType: ocrClaimPayload.type,
              claimPayload: JSON.stringify(ocrClaimPayload),
              signature: ocrSignature,
              issuedAt,
            });
          } catch (error) {
            logger.error(
              { error: String(error), jobId, userId: job.userId },
              "Failed to sign OCR claim in finalize job"
            );
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
            await insertSignedClaim({
              id: uuidv4(),
              userId: job.userId,
              documentId: draft.documentId,
              claimType: livenessClaimPayload.type,
              claimPayload: JSON.stringify(livenessClaimPayload),
              signature: livenessSignature,
              issuedAt,
            });
          } catch (error) {
            logger.error(
              { error: String(error), jobId, userId: job.userId },
              "Failed to sign liveness claim in finalize job"
            );
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
            await insertSignedClaim({
              id: uuidv4(),
              userId: job.userId,
              documentId: draft.documentId,
              claimType: faceMatchClaimPayload.type,
              claimPayload: JSON.stringify(faceMatchClaimPayload),
              signature: faceMatchSignature,
              issuedAt,
            });
          } catch (error) {
            logger.error(
              { error: String(error), jobId, userId: job.userId },
              "Failed to sign face match claim in finalize job"
            );
            issues.push("signed_face_match_claim_failed");
          }
        }

        const birthYearOffsetEncrypted = false;
        const countryCodeEncrypted = false;
        const livenessScoreEncrypted = false;
        const fheStatus: "pending" | "complete" | "error" = job.fheKeyId
          ? "pending"
          : "error";
        if (!job.fheKeyId) {
          issues.push("fhe_key_missing");
        }

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
          fheError: fheStatus === "error" ? "fhe_key_missing" : null,
        };
        if (job.fheKeyId) {
          bundleUpdate.fheKeyId = job.fheKeyId;
        }

        await upsertIdentityBundle(bundleUpdate);

        // Invalidate cached verification status
        invalidateVerificationCache(job.userId);
        if (job.fheKeyId) {
          scheduleFheEncryption({
            userId: job.userId,
            requestId: job.id,
            flowId: draft.onboardingSessionId,
            reason: "identity_finalize",
            birthYearOffset: pendingInputs?.birthYearOffset ?? null,
            countryCodeNumeric: pendingInputs?.countryCodeNumeric ?? null,
          });
        }

        if (documentProcessed && draft.documentId) {
          try {
            await createIdentityDocument({
              id: draft.documentId,
              userId: job.userId,
              documentType: draft.documentType ?? null,
              issuerCountry: draft.issuerCountry ?? null,
              documentHash: isDuplicateDocument
                ? null
                : (draft.documentHash ?? null),
              nameCommitment: draft.nameCommitment ?? null,
              verifiedAt: verified ? new Date().toISOString() : null,
              confidenceScore: draft.confidenceScore ?? null,
              status: verified ? "verified" : "failed",
            });
          } catch (error) {
            logger.error(
              {
                error: String(error),
                jobId,
                userId: job.userId,
                documentId: draft.documentId,
              },
              "Failed to create identity document in finalize job"
            );
            issues.push("failed_to_create_identity_document");
          }
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
            nationalityCommitmentGenerated: Boolean(draft.nationalityClaimHash),
            countryCodeEncrypted,
            livenessScoreEncrypted,
          },
          fheStatus,
          fheErrors: undefined,
          processingTimeMs: Date.now() - startTime,
          issues,
        };

        await updateIdentityVerificationJobStatus({
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
        await updateIdentityVerificationJobStatus({
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
        return await processDocument(
          input.image,
          ctx.requestId,
          ctx.flowId ?? undefined
        );
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
          flowId: ctx.flowId ?? undefined,
        });
        issues.push(...(documentResult?.validationIssues || []));
      } catch (error) {
        logger.error(
          { error: String(error), requestId: ctx.requestId },
          "Document OCR processing failed in prepareDocument"
        );
        issues.push("document_processing_failed");
      }

      const sessionId = validation.session.id;
      const existingDraft =
        validation.session.identityDraftId !== null &&
        validation.session.identityDraftId !== undefined
          ? await getIdentityDraftById(validation.session.identityDraftId)
          : await getIdentityDraftBySessionId(sessionId);

      const draftId = existingDraft?.id ?? uuidv4();
      const documentId = existingDraft?.documentId ?? uuidv4();

      const documentProcessed = Boolean(documentResult?.commitments);
      const documentHash = documentResult?.commitments?.documentHash ?? null;
      let documentHashField: string | null = null;
      if (documentHash) {
        try {
          documentHashField = await getDocumentHashField(documentHash);
        } catch (error) {
          logger.error(
            { error: String(error), documentHash },
            "Failed to generate document hash field in prepareDocument"
          );
          issues.push("document_hash_field_failed");
        }
      }

      let isDuplicateDocument = false;
      if (documentHash) {
        const hashExists = await documentHashExists(documentHash);
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
      const nationalityCode =
        documentResult?.extractedData?.nationalityCode ?? null;
      const nationalityCodeNumeric = nationalityCode
        ? (getNationalityCode(nationalityCode) ?? null)
        : null;

      let ageClaimHash: string | null = null;
      let docValidityClaimHash: string | null = null;
      let nationalityClaimHash: string | null = null;
      if (documentHashField) {
        const hashTasks: Promise<void>[] = [];
        if (birthYear !== null) {
          hashTasks.push(
            (async () => {
              try {
                ageClaimHash = await computeClaimHash({
                  value: birthYear,
                  documentHashField,
                });
              } catch (error) {
                logger.error(
                  { error: String(error), birthYear },
                  "Failed to compute age claim hash"
                );
                issues.push("age_claim_hash_failed");
              }
            })()
          );
        }
        if (expiryDateInt !== null) {
          hashTasks.push(
            (async () => {
              try {
                docValidityClaimHash = await computeClaimHash({
                  value: expiryDateInt,
                  documentHashField,
                });
              } catch (error) {
                logger.error(
                  { error: String(error), expiryDateInt },
                  "Failed to compute doc validity claim hash"
                );
                issues.push("doc_validity_claim_hash_failed");
              }
            })()
          );
        }
        if (nationalityCodeNumeric) {
          hashTasks.push(
            (async () => {
              try {
                nationalityClaimHash = await computeClaimHash({
                  value: nationalityCodeNumeric,
                  documentHashField,
                });
              } catch (error) {
                logger.error(
                  { error: String(error), nationalityCodeNumeric },
                  "Failed to compute nationality claim hash"
                );
                issues.push("nationality_claim_hash_failed");
              }
            })()
          );
        }
        if (hashTasks.length) {
          await Promise.all(hashTasks);
        }
      }
      const issuerCountry =
        documentResult?.documentOrigin ||
        documentResult?.extractedData?.nationalityCode ||
        null;

      const hasExpiredDocument = Boolean(
        documentResult?.validationIssues?.includes("document_expired")
      );
      const isDocumentValid =
        documentProcessed &&
        (documentResult?.confidence ?? 0) > 0.3 &&
        Boolean(documentResult?.extractedData?.documentNumber) &&
        !isDuplicateDocument &&
        !hasExpiredDocument;

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

      await upsertIdentityDraft({
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
        ageClaimHash,
        docValidityClaimHash,
        nationalityClaimHash,
        confidenceScore: documentResult?.confidence ?? null,
        ocrIssues: issues.length ? JSON.stringify(issues) : null,
      });

      await updateWizardProgress(
        validation.session.id,
        {
          documentProcessed: isDocumentValid,
          documentHash: documentHash ?? undefined,
          identityDraftId: draftId,
          step: Math.max(validation.session.step ?? 1, 2),
        },
        ctx.resHeaders
      );

      return {
        success: true,
        draftId,
        documentId,
        documentProcessed,
        isDocumentValid,
        isDuplicateDocument,
        issues,
        userSalt: documentResult?.commitments?.userSalt ?? null,
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
    getCachedVerificationStatus(ctx.userId)
  ),

  /** Returns current FHE status for the authenticated user (for client polling). */
  fheStatus: protectedProcedure.query(async ({ ctx }) => {
    const bundle = await getIdentityBundleByUserId(ctx.userId);
    return {
      status: bundle?.fheStatus ?? null,
      error: bundle?.fheError ?? null,
    };
  }),

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

      const draft = await getIdentityDraftById(input.draftId);
      if (!draft) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Identity draft not found",
        });
      }

      // Validate faces using the face-validation module
      const faceValidation = await validateFaces(
        input.selfieImage,
        input.documentImage
      );
      issues.push(...faceValidation.issues);

      const {
        antispoofScore,
        liveScore,
        livenessPassed,
        faceMatchConfidence,
        faceMatchPassed,
      } = faceValidation;

      await updateIdentityDraft(draft.id, {
        antispoofScore,
        liveScore,
        livenessPassed,
        faceMatchConfidence,
        faceMatchPassed,
      });

      await updateWizardProgress(
        stepValidation.session.id,
        {
          livenessPassed,
          faceMatchPassed,
          step: Math.max(stepValidation.session.step ?? 1, 4),
        },
        ctx.resHeaders
      );

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
        birthYearOffset: z.number().int().min(0).max(255).optional(),
        countryCodeNumeric: z.number().int().min(0).max(999).optional(),
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

      const draft = await getIdentityDraftById(input.draftId);
      if (!draft) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Identity draft not found",
        });
      }

      const existingJob = await getLatestIdentityVerificationJobForDraft(
        input.draftId
      );
      if (
        existingJob &&
        existingJob.status !== "error" &&
        existingJob.status !== "complete"
      ) {
        pendingFheInputs.set(existingJob.id, {
          birthYearOffset: input.birthYearOffset,
          countryCodeNumeric: input.countryCodeNumeric,
        });
        scheduleIdentityJob(existingJob.id);
        return { jobId: existingJob.id, status: existingJob.status };
      }

      const jobId = uuidv4();
      await createIdentityVerificationJob({
        id: jobId,
        draftId: input.draftId,
        userId: ctx.userId,
        fheKeyId: input.fheKeyId,
      });
      pendingFheInputs.set(jobId, {
        birthYearOffset: input.birthYearOffset,
        countryCodeNumeric: input.countryCodeNumeric,
      });

      scheduleIdentityJob(jobId);

      return { jobId, status: "queued" };
    }),

  /**
   * Check status for an identity finalization job.
   */
  finalizeStatus: protectedProcedure
    .input(z.object({ jobId: z.string().min(1) }))
    .query(async ({ input }) => {
      const job = await getIdentityVerificationJobById(input.jobId);
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
   * 7. Queue FHE encryption for sensitive fields (async)
   * 8. Store identity proof (only commitments, not raw PII)
   */
  verify: protectedProcedure
    .input(
      z.object({
        documentImage: z.string().min(1),
        selfieImage: z.string().min(1),
        userSalt: z.string().min(1),
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
      const existingDocument = await getLatestIdentityDocumentByUserId(userId);
      const userSalt = input.userSalt;
      const fheKeyId = input.fheKeyId;
      const hasFheKeyMaterial = Boolean(fheKeyId);

      let documentResult: OcrProcessResult | null = null;
      try {
        documentResult = await processDocumentOcr({
          image: input.documentImage,
          userSalt,
          requestId: ctx.requestId,
          flowId: ctx.flowId ?? undefined,
        });
        issues.push(...(documentResult?.validationIssues || []));
      } catch (error) {
        logger.error(
          { error: String(error), requestId: ctx.requestId, userId },
          "Document OCR processing failed in verify"
        );
        issues.push("document_processing_failed");
      }

      let isDuplicateDocument = false;
      if (documentResult?.commitments?.documentHash) {
        const hashExists = await documentHashExists(
          documentResult.commitments.documentHash
        );
        if (hashExists && !existingDocument) {
          isDuplicateDocument = true;
          issues.push("duplicate_document");
        }
      }

      // Validate faces using the face-validation module
      const faceValidation = await validateFaces(
        input.selfieImage,
        input.documentImage
      );
      issues.push(...faceValidation.issues);

      const documentProcessed = Boolean(documentResult?.commitments);
      const identityDocumentId = documentProcessed ? uuidv4() : null;
      const documentHash = documentResult?.commitments?.documentHash ?? null;
      let documentHashField: string | null = null;
      if (documentHash) {
        try {
          documentHashField = await getDocumentHashField(documentHash);
        } catch (error) {
          logger.error(
            { error: String(error), documentHash },
            "Failed to generate document hash field"
          );
          issues.push("document_hash_field_failed");
        }
      }

      // Compute claim hashes and store signed claims
      const birthYear = parseBirthYear(
        documentResult?.extractedData?.dateOfBirth
      );
      const expiryDateInt = parseDateToInt(
        documentResult?.extractedData?.expirationDate
      );
      const nationalityCode =
        documentResult?.extractedData?.nationalityCode ?? null;
      const nationalityCodeNumeric = nationalityCode
        ? (getNationalityCode(nationalityCode) ?? null)
        : null;

      // Compute claim hashes if document hash field is available
      let claimHashes = { age: null, docValidity: null, nationality: null } as {
        age: string | null;
        docValidity: string | null;
        nationality: string | null;
      };
      if (documentHashField) {
        const hashResult = await computeClaimHashes({
          documentHashField,
          birthYear,
          expiryDateInt,
          nationalityCodeNumeric,
        });
        claimHashes = hashResult.hashes;
        issues.push(...hashResult.issues);
      }

      // Store all verification claims using the claims-signing module
      const claimIssues = await storeVerificationClaims({
        userId,
        documentId: identityDocumentId,
        documentHash,
        documentHashField,
        documentType: documentResult?.documentType ?? null,
        issuerCountry:
          documentResult?.documentOrigin ||
          documentResult?.extractedData?.nationalityCode ||
          null,
        confidence: documentResult?.confidence ?? null,
        claimHashes,
        antispoofScore: faceValidation.antispoofScore,
        liveScore: faceValidation.liveScore,
        livenessPassed: faceValidation.livenessPassed,
        faceMatchConfidence: faceValidation.faceMatchConfidence,
        faceMatchPassed: faceValidation.faceMatchPassed,
      });
      issues.push(...claimIssues);

      let nationalityCommitment: string | null = null;

      if (!hasFheKeyMaterial) {
        issues.push("fhe_key_missing");
      }

      if (nationalityCode && documentResult?.commitments?.userSalt) {
        try {
          nationalityCommitment = await sha256CommitmentHex({
            value: nationalityCode,
            salt: documentResult.commitments.userSalt,
          });
        } catch (error) {
          logger.error(
            { error: String(error), nationalityCode },
            "Failed to generate nationality commitment"
          );
          issues.push("nationality_commitment_failed");
        }
      }

      const isDocumentValid =
        documentProcessed &&
        (documentResult?.confidence ?? 0) > 0.3 &&
        Boolean(documentResult?.extractedData?.documentNumber);
      const livenessPassed = faceValidation.livenessPassed;
      const facesMatch = faceValidation.faceMatchPassed;
      const ageProofGenerated = false;
      const birthYearOffsetEncrypted = false;
      const docValidityProofGenerated = false;
      const nationalityCommitmentGenerated = Boolean(nationalityCommitment);
      const countryCodeEncrypted = false;
      const livenessScoreEncrypted = false;
      const fheStatus: "pending" | "complete" | "error" = hasFheKeyMaterial
        ? "pending"
        : "error";
      const verified =
        documentProcessed &&
        isDocumentValid &&
        livenessPassed &&
        facesMatch &&
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
        userId,
        status: bundleStatus,
        issuerId: ISSUER_ID,
        policyVersion: POLICY_VERSION,
        fheStatus,
        fheError: fheStatus === "error" ? "fhe_key_missing" : null,
      };
      if (fheKeyId) {
        bundleUpdate.fheKeyId = fheKeyId;
      }

      await upsertIdentityBundle(bundleUpdate);

      // Invalidate cached verification status
      invalidateVerificationCache(userId);

      if (
        documentProcessed &&
        identityDocumentId &&
        documentResult?.commitments
      ) {
        try {
          await createIdentityDocument({
            id: identityDocumentId,
            userId,
            documentType: documentResult.documentType ?? null,
            issuerCountry:
              documentResult.documentOrigin ||
              documentResult.extractedData?.nationalityCode ||
              null,
            documentHash: documentResult.commitments.documentHash ?? null,
            nameCommitment: documentResult.commitments.nameCommitment ?? null,
            verifiedAt: verified ? new Date().toISOString() : null,
            confidenceScore: documentResult.confidence ?? null,
            status: verified ? "verified" : "failed",
          });
        } catch (error) {
          logger.error(
            { error: String(error), userId, documentId: identityDocumentId },
            "Failed to create identity document"
          );
          issues.push("failed_to_create_identity_document");
        }
      }

      if (fheKeyId) {
        const birthYearOffset = calculateBirthYearOffset(
          documentResult?.extractedData?.dateOfBirth
        );
        const countryCodeSource =
          documentResult?.documentOrigin ||
          documentResult?.extractedData?.nationalityCode ||
          null;
        const resolvedCountryCode = countryCodeSource
          ? countryCodeToNumeric(countryCodeSource)
          : 0;
        scheduleFheEncryption({
          userId,
          requestId: ctx.requestId,
          flowId: ctx.flowId ?? undefined,
          reason: "identity_verify",
          birthYearOffset: birthYearOffset ?? null,
          countryCodeNumeric:
            resolvedCountryCode > 0 ? resolvedCountryCode : null,
        });
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
        fheErrors: undefined,
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
        userSalt: z.string().min(1, "User salt is required"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const document = await getSelectedIdentityDocumentByUserId(ctx.userId);
      if (!document?.nameCommitment) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "User has not completed identity verification",
        });
      }

      const claimedCommitment = generateNameCommitment(
        input.claimedName,
        input.userSalt
      );

      const matches = crypto.timingSafeEqual(
        Buffer.from(claimedCommitment),
        Buffer.from(document.nameCommitment)
      );

      return { matches };
    }),
});
