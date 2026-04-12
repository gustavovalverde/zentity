import z from "zod";

import { getIdentityDraftById } from "@/lib/db/queries/identity";
import {
  ANTISPOOF_LIVE_THRESHOLD,
  ANTISPOOF_REAL_THRESHOLD,
  FACE_MATCH_MIN_CONFIDENCE,
} from "@/lib/identity/liveness/thresholds";
import { hashIdentifier } from "@/lib/observability/telemetry";

import { protectedProcedure } from "../../server";

/**
 * Liveness status check procedure.
 *
 * Returns the current liveness and face match status for a draft.
 * Results are written directly by the socket handler (liveness) and
 * the faceMatch procedure (face matching) - this just reports status.
 *
 * This is a read-only check to verify the draft is ready for finalization.
 */
export const livenessStatusProcedure = protectedProcedure
  .input(
    z.object({
      draftId: z.string().min(1),
    })
  )
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

    // Verify draft belongs to this user
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

    // Derive pass/fail from scores using policy thresholds
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
