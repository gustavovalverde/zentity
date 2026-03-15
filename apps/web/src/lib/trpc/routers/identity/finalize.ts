import { TRPCError } from "@trpc/server";
import { v4 as uuidv4 } from "uuid";
import z from "zod";

import {
  createIdentityVerificationJob,
  getIdentityBundleByUserId,
  getIdentityDraftById,
  getIdentityVerificationJobById,
  getLatestIdentityVerificationJobForDraft,
} from "@/lib/db/queries/identity";
import {
  ANTISPOOF_LIVE_THRESHOLD,
  ANTISPOOF_REAL_THRESHOLD,
  FACE_MATCH_MIN_CONFIDENCE,
} from "@/lib/identity/liveness/policy";
import { hashIdentifier } from "@/lib/observability/telemetry";

import { protectedProcedure } from "../../server";
import {
  scheduleIdentityJob,
  type VerifyIdentityResponse,
} from "./helpers/job-processor";

/**
 * Dashboard identity finalization procedure.
 *
 * Creates signed claims and triggers FHE encryption for dashboard users.
 * Requires authenticated session.
 */
export const finalizeProcedure = protectedProcedure
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
export const finalizeStatusProcedure = protectedProcedure
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
      error: job.error
        ? "Verification processing failed. Please try again."
        : undefined,
      startedAt: job.startedAt ?? undefined,
      finishedAt: job.finishedAt ?? undefined,
    };
  });
