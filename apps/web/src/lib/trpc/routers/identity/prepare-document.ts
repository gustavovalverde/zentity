import z from "zod";

import { env } from "@/env";
import {
  createVerification,
  getLatestIdentityDraftByUserId,
  getLatestVerification,
  upsertIdentityDraft,
} from "@/lib/db/queries/identity";
import { processDocumentWithOcr } from "@/lib/identity/document/process-document";
import { dobDaysToBirthYearOffset } from "@/lib/identity/verification/birth-year";
import { logger } from "@/lib/logging/logger";
import { scheduleFheEncryption } from "@/lib/privacy/fhe/encryption";

import { protectedProcedure } from "../../server";

/**
 * Document verification procedure.
 *
 * For authenticated users verifying identity from the dashboard (post-sign-up).
 * Requires authenticated session.
 *
 * Authentication: `protectedProcedure` (authenticated user via better-auth)
 */
export const prepareDocumentProcedure = protectedProcedure
  .input(z.object({ image: z.string().min(1, "Image is required") }))
  .mutation(async ({ ctx, input }) => {
    const userId = ctx.session.user.id;

    ctx.span?.setAttribute(
      "dashboard.document_image_bytes",
      Buffer.byteLength(input.image)
    );

    // Look up existing draft for this user
    const existingDraft = await getLatestIdentityDraftByUserId(userId);

    // When re-verifying (user already has a verified verification), create fresh
    // draft + verification IDs. Reusing old IDs causes the INSERT to fail silently
    // (verification already exists) leaving stale claims/proofs attached to it.
    const existingVerification = await getLatestVerification(userId);
    const isReverification = existingVerification?.status === "verified";

    // Process document using shared logic
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

    // Create verification record with "pending" status first (draft references it)
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
        logger.debug(
          {
            error: String(error),
            userId,
            verificationId: result.verificationId,
          },
          "Verification record already exists or failed to create"
        );
      }
    }

    // Persist draft with user reference
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
