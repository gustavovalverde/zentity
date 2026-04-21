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

import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";

import { env } from "@/env";
import { db } from "@/lib/db/connection";
import {
  createIdentityVerificationJob,
  createVerification,
  getAccountIdentity,
  getIdentityBundleByUserId,
  getIdentityDraftById,
  getIdentityVerificationJobById,
  getLatestIdentityDraftByUserId,
  getLatestIdentityVerificationJobForDraft,
  getLatestVerification,
  revokeIdentity,
  upsertIdentityDraft,
} from "@/lib/db/queries/identity";
import { oidc4vciIssuedCredentials } from "@/lib/db/schema/oidc-credentials";
import { processDocumentWithOcr } from "@/lib/identity/document/process";
import {
  ANTISPOOF_LIVE_THRESHOLD,
  ANTISPOOF_REAL_THRESHOLD,
  FACE_MATCH_MIN_CONFIDENCE,
} from "@/lib/identity/liveness/thresholds";
import { deliverPendingValidityDeliveries } from "@/lib/identity/validity/delivery";
import { getIdentityValidityOverview } from "@/lib/identity/validity/read-model";
import { dobDaysToBirthYearOffset } from "@/lib/identity/verification/birth-year";
import {
  scheduleIdentityJob,
  type VerifyIdentityResponse,
} from "@/lib/identity/verification/job-processor";
import { getVerificationReadModel } from "@/lib/identity/verification/read-model";
import { logger } from "@/lib/logging/logger";
import { hashIdentifier } from "@/lib/observability/telemetry";
import { scheduleFheEncryption } from "@/lib/privacy/fhe/encryption";

import { adminProcedure, protectedProcedure, router } from "../server";

function isUniqueConstraintError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  if ("code" in error && error.code === "SQLITE_CONSTRAINT_UNIQUE") {
    return true;
  }
  return error.message.includes("UNIQUE constraint failed");
}

/**
 * Document verification procedure.
 *
 * For authenticated users verifying identity from the dashboard (post-sign-up).
 * Requires authenticated session.
 */
const prepareDocumentProcedure = protectedProcedure
  .input(z.object({ image: z.string().min(1, "Image is required") }))
  .mutation(async ({ ctx, input }) => {
    const userId = ctx.session.user.id;

    ctx.span?.setAttribute(
      "dashboard.document_image_bytes",
      Buffer.byteLength(input.image)
    );

    const existingDraft = await getLatestIdentityDraftByUserId(userId);

    // When re-verifying (user already has a verified verification), create fresh
    // draft + verification IDs. Reusing old IDs causes the INSERT to fail silently
    // (verification already exists) leaving stale claims/proofs attached to it.
    const existingVerification = await getLatestVerification(userId);
    const isReverification = existingVerification?.status === "verified";

    const result = await processDocumentWithOcr({
      image: input.image,
      requestId: ctx.requestId,
      flowId: ctx.flowId ?? undefined,
      userId,
      dedupSecret: env.DEDUP_HMAC_SECRET,
      existingDraftId: isReverification ? undefined : existingDraft?.id,
      existingVerificationId: isReverification
        ? undefined
        : existingDraft?.verificationId,
    });

    ctx.span?.setAttribute(
      "dashboard.document_processed",
      result.documentProcessed
    );
    ctx.span?.setAttribute("dashboard.document_valid", result.isDocumentValid);
    ctx.span?.setAttribute(
      "dashboard.document_duplicate",
      result.isDuplicateDocument
    );
    ctx.span?.setAttribute("dashboard.issues_count", result.issues.length);

    if (result.isDocumentValid && result.ocrResult?.commitments) {
      try {
        await createVerification({
          id: result.verificationId,
          userId,
          method: "ocr",
          status: "pending",
          documentType: result.ocrResult.documentType ?? null,
          issuerCountry: result.issuerCountry ?? null,
          documentHash: result.ocrResult.commitments.documentHash ?? null,
          dedupKey: result.dedupKey ?? null,
          nameCommitment: result.ocrResult.commitments.nameCommitment ?? null,
          confidenceScore: result.ocrResult.confidence ?? null,
          birthYearOffset: dobDaysToBirthYearOffset(result.parsedDates.dobDays),
        });
      } catch (error) {
        logger.error(
          {
            error: String(error),
            userId,
            verificationId: result.verificationId,
            dedupKey: result.dedupKey,
          },
          "Failed to create verification record for OCR flow"
        );

        if (isUniqueConstraintError(error)) {
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "This document is already linked to another active verification. Refresh and restart verification.",
          });
        }

        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            "Could not start verification after processing the document. Please retry the document step.",
        });
      }
    }

    await upsertIdentityDraft({
      id: result.draftId,
      userId,
      verificationId: result.verificationId,
      documentProcessed: result.documentProcessed,
      isDocumentValid: result.isDocumentValid,
      isDuplicateDocument: result.isDuplicateDocument,
      documentHashField: result.documentHashField,
      ageClaimHash: result.claimHashes.ageClaimHash,
      docValidityClaimHash: result.claimHashes.docValidityClaimHash,
      nationalityClaimHash: result.claimHashes.nationalityClaimHash,
      ocrIssues: result.issues.length ? JSON.stringify(result.issues) : null,
    });

    // Schedule FHE encryption with transient dobDays (never persisted to DB)
    if (result.parsedDates.dobDays !== null) {
      scheduleFheEncryption({
        userId,
        requestId: ctx.requestId,
        flowId: ctx.flowId ?? undefined,
        reason: "document_processed",
        dobDays: result.parsedDates.dobDays,
      });
    }

    return {
      success: true,
      draftId: result.draftId,
      verificationId: result.verificationId,
      documentProcessed: result.documentProcessed,
      isDocumentValid: result.isDocumentValid,
      isDuplicateDocument: result.isDuplicateDocument,
      issues: result.issues,
      userSalt: result.ocrResult?.commitments?.userSalt ?? null,
      documentResult: result.ocrResult
        ? {
            documentType: result.ocrResult.documentType,
            documentOrigin: result.ocrResult.documentOrigin,
            confidence: result.ocrResult.confidence,
            extractedData: result.ocrResult.extractedData,
            validationIssues: result.ocrResult.validationIssues,
          }
        : {
            documentType: "unknown",
            confidence: 0,
            validationIssues: ["document_processing_failed"],
          },
    };
  });

/**
 * Liveness status check procedure.
 *
 * Returns the current liveness and face match status for a draft.
 * Results are written directly by the socket handler (liveness) and
 * the faceMatch procedure (face matching); this just reports status.
 */
const livenessStatusProcedure = protectedProcedure
  .input(z.object({ draftId: z.string().min(1) }))
  .mutation(async ({ ctx, input }) => {
    const startTime = Date.now();
    const userId = ctx.session.user.id;

    ctx.span?.setAttribute(
      "dashboard.draft_id_hash",
      hashIdentifier(input.draftId)
    );

    const draft = await getIdentityDraftById(input.draftId);
    if (!draft) {
      return {
        success: false,
        error: "Identity draft not found",
        livenessPassed: false,
        faceMatchPassed: false,
        faceMatchConfidence: 0,
        processingTimeMs: Date.now() - startTime,
        issues: ["draft_not_found"],
      };
    }

    if (draft.userId !== userId) {
      return {
        success: false,
        error: "Draft does not belong to this user",
        livenessPassed: false,
        faceMatchPassed: false,
        faceMatchConfidence: 0,
        processingTimeMs: Date.now() - startTime,
        issues: ["unauthorized"],
      };
    }

    const livenessPassed =
      (draft.antispoofScore ?? 0) >= ANTISPOOF_REAL_THRESHOLD &&
      (draft.liveScore ?? 0) >= ANTISPOOF_LIVE_THRESHOLD;
    const faceMatchPassed =
      (draft.faceMatchConfidence ?? 0) >= FACE_MATCH_MIN_CONFIDENCE;
    const faceMatchConfidence = draft.faceMatchConfidence ?? 0;

    ctx.span?.setAttribute("dashboard.liveness_passed", livenessPassed);
    ctx.span?.setAttribute("dashboard.face_match_passed", faceMatchPassed);
    ctx.span?.setAttribute(
      "dashboard.face_match_confidence",
      faceMatchConfidence
    );
    ctx.span?.setAttribute("dashboard.processing_ms", Date.now() - startTime);

    const issues: string[] = [];
    if (!livenessPassed) {
      issues.push("liveness_not_completed");
    }
    if (!faceMatchPassed) {
      issues.push("face_match_not_completed");
    }

    return {
      success: livenessPassed && faceMatchPassed,
      livenessPassed,
      faceMatchPassed,
      faceMatchConfidence,
      processingTimeMs: Date.now() - startTime,
      issues,
    };
  });

/**
 * Dashboard identity finalization procedure.
 *
 * Creates signed claims and triggers FHE encryption for dashboard users.
 * Requires authenticated session.
 */
const finalizeProcedure = protectedProcedure
  .input(z.object({ draftId: z.string().min(1) }))
  .mutation(async ({ ctx, input }) => {
    const userId = ctx.session.user.id;

    ctx.span?.setAttribute(
      "dashboard.draft_id_hash",
      hashIdentifier(input.draftId)
    );

    const draft = await getIdentityDraftById(input.draftId);
    if (!draft) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Identity draft not found",
      });
    }

    if (draft.userId !== userId) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Draft does not belong to this user",
      });
    }

    const livenessPassed =
      (draft.antispoofScore ?? 0) >= ANTISPOOF_REAL_THRESHOLD &&
      (draft.liveScore ?? 0) >= ANTISPOOF_LIVE_THRESHOLD;
    const faceMatchPassed =
      (draft.faceMatchConfidence ?? 0) >= FACE_MATCH_MIN_CONFIDENCE;
    if (!(livenessPassed && faceMatchPassed)) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Please complete liveness verification first.",
      });
    }

    const bundle = await getIdentityBundleByUserId(userId);
    if (!bundle?.fheKeyId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "FHE keys not set up. Please complete account setup first.",
      });
    }

    ctx.span?.setAttribute("fhe.key_id_hash", hashIdentifier(bundle.fheKeyId));

    const existingJob = await getLatestIdentityVerificationJobForDraft(
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
    await createIdentityVerificationJob({
      id: jobId,
      draftId: input.draftId,
      verificationId: draft.verificationId,
      userId,
      fheKeyId: bundle.fheKeyId,
    });

    scheduleIdentityJob(jobId);

    return { jobId, status: "queued" };
  });

/**
 * Check status for an identity finalization job.
 */
const finalizeStatusProcedure = protectedProcedure
  .input(z.object({ jobId: z.string().min(1) }))
  .query(async ({ ctx, input }) => {
    const job = await getIdentityVerificationJobById(input.jobId);
    if (!job) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Job not found",
      });
    }

    if (job.userId !== ctx.session.user.id) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Job does not belong to this user",
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
  });

/**
 * Admin revocation — revokes a user's identity with a reason.
 * Only users with the "admin" role can call this procedure.
 */
const revokeProcedure = adminProcedure
  .input(
    z.object({
      userId: z.string().min(1),
      reason: z.string().min(1).max(500),
    })
  )
  .mutation(async ({ ctx, input }) => {
    const result = await revokeIdentity(
      input.userId,
      ctx.session.user.email ?? ctx.session.user.id,
      input.reason,
      "admin"
    );
    if (result.eventId) {
      await deliverPendingValidityDeliveries({ eventId: result.eventId });
    }
    return result;
  });

/** User self-revocation — users can revoke their own identity (GDPR). */
const selfRevokeProcedure = protectedProcedure
  .input(z.object({ reason: z.string().min(1).max(500) }))
  .mutation(async ({ ctx, input }) => {
    const userId = ctx.session.user.id;
    if (!userId) {
      throw new TRPCError({ code: "UNAUTHORIZED" });
    }
    const result = await revokeIdentity(
      userId,
      "self",
      input.reason,
      "product"
    );
    if (result.eventId) {
      await deliverPendingValidityDeliveries({ eventId: result.eventId });
    }
    return result;
  });

/**
 * Admin individual credential revocation — revokes a single OID4VCI
 * credential without triggering the full identity revocation cascade.
 */
const revokeCredentialProcedure = adminProcedure
  .input(z.object({ credentialId: z.string().min(1) }))
  .mutation(async ({ input }) => {
    const credential = await db
      .select({
        id: oidc4vciIssuedCredentials.id,
        status: oidc4vciIssuedCredentials.status,
      })
      .from(oidc4vciIssuedCredentials)
      .where(eq(oidc4vciIssuedCredentials.id, input.credentialId))
      .limit(1)
      .get();

    if (!credential) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Credential not found",
      });
    }

    if (credential.status === 1) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "Credential already revoked",
      });
    }

    await db
      .update(oidc4vciIssuedCredentials)
      .set({
        status: 1,
        revokedAt: new Date(),
      })
      .where(eq(oidc4vciIssuedCredentials.id, input.credentialId))
      .run();

    return { revoked: true };
  });

const getOverviewProcedure = adminProcedure
  .input(z.object({ userId: z.string().min(1) }))
  .query(async ({ input }) => {
    const [accountIdentity, verificationModel, validity] = await Promise.all([
      getAccountIdentity(input.userId),
      getVerificationReadModel(input.userId),
      getIdentityValidityOverview(input.userId),
    ]);

    return {
      userId: input.userId,
      bundle: accountIdentity.bundle
        ? {
            validityStatus: accountIdentity.bundle.validityStatus,
            effectiveVerificationId:
              accountIdentity.bundle.effectiveVerificationId,
            walletAddress: accountIdentity.bundle.walletAddress,
            policyVersion: accountIdentity.bundle.policyVersion,
            issuerId: accountIdentity.bundle.issuerId,
            attestationExpiresAt: accountIdentity.bundle.attestationExpiresAt,
            fheKeyId: accountIdentity.bundle.fheKeyId,
            fheStatus: accountIdentity.bundle.fheStatus,
            revokedAt: accountIdentity.bundle.revokedAt,
            revokedBy: accountIdentity.bundle.revokedBy,
            revokedReason: accountIdentity.bundle.revokedReason,
            updatedAt: accountIdentity.bundle.updatedAt,
          }
        : null,
      groupedIdentity: verificationModel.groupedIdentity,
      effectiveVerification: accountIdentity.effectiveVerification
        ? {
            id: accountIdentity.effectiveVerification.id,
            method: accountIdentity.effectiveVerification.method,
            status: accountIdentity.effectiveVerification.status,
            verifiedAt: accountIdentity.effectiveVerification.verifiedAt,
            issuerCountry: accountIdentity.effectiveVerification.issuerCountry,
            documentType: accountIdentity.effectiveVerification.documentType,
          }
        : null,
      verification: {
        verificationId: verificationModel.verificationId,
        method: verificationModel.method,
        verifiedAt: verificationModel.verifiedAt,
        level: verificationModel.compliance.level,
        checked: verificationModel.compliance.verified,
      },
      latestValidityEvent: validity.latestEvent,
      latestValidityDeliveries: validity.latestEventDeliveries,
      validityDeliverySummary: validity.deliverySummary,
    };
  });

export const identityRouter = router({
  prepareDocument: prepareDocumentProcedure,
  livenessStatus: livenessStatusProcedure,
  finalize: finalizeProcedure,
  finalizeStatus: finalizeStatusProcedure,
  getOverview: getOverviewProcedure,
  revokeVerification: revokeProcedure,
  revokeCredential: revokeCredentialProcedure,
  selfRevoke: selfRevokeProcedure,
});
