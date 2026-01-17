import { TRPCError } from "@trpc/server";
import { v4 as uuidv4 } from "uuid";
import z from "zod";

import {
  getSessionFromCookie,
  updateWizardProgress,
  validateStepAccess,
} from "@/lib/db/onboarding-session";
import {
  createIdentityVerificationJob,
  getIdentityBundleByUserId,
  getIdentityDraftById,
  getIdentityVerificationJobById,
  getLatestIdentityVerificationJobForDraft,
  updateIdentityDraft,
} from "@/lib/db/queries/identity";
import { validateFaces } from "@/lib/identity/verification/face-validation";
import { hashIdentifier } from "@/lib/observability/telemetry";

import { protectedProcedure, publicProcedure } from "../../server";
import {
  scheduleIdentityJob,
  type VerifyIdentityResponse,
} from "./helpers/job-processor";
import { getCachedVerificationStatus } from "./helpers/verification-cache";

/** Returns the current verification status for the authenticated user. */
export const statusProcedure = protectedProcedure.query(({ ctx }) =>
  getCachedVerificationStatus(ctx.userId)
);

/** Returns current FHE status for the authenticated user (for client polling). */
export const fheStatusProcedure = protectedProcedure.query(async ({ ctx }) => {
  const bundle = await getIdentityBundleByUserId(ctx.userId);
  return {
    status: bundle?.fheStatus ?? null,
    error: bundle?.fheError ?? null,
  };
});

/**
 * Precompute liveness + face match and persist to the identity draft.
 * Runs after liveness challenges are complete (or skipped).
 */
export const prepareLivenessProcedure = publicProcedure
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
    const stepValidation = validateStepAccess(onboardingSession, "face-match");
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
    ctx.span?.setAttribute("onboarding.processing_ms", Date.now() - startTime);

    return {
      success: true,
      livenessPassed,
      faceMatchPassed,
      faceMatchConfidence,
      processingTimeMs: Date.now() - startTime,
      issues,
    };
  });

/**
 * Enqueue identity finalization (FHE + signed claims) as a DB-backed job.
 */
export const finalizeAsyncProcedure = protectedProcedure
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

    // Store birthYearOffset in draft for later FHE encryption (deferred to proof_stored)
    if (typeof input.birthYearOffset === "number") {
      await updateIdentityDraft(draft.id, {
        birthYearOffset: input.birthYearOffset,
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

    scheduleIdentityJob(jobId);

    return { jobId, status: "queued" };
  });

/**
 * Check status for an identity finalization job.
 */
export const finalizeStatusProcedure = protectedProcedure
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
  });
