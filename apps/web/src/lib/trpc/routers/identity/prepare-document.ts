import z from "zod";

import {
  createIdentityDocument,
  getLatestIdentityDraftByUserId,
  upsertIdentityDraft,
} from "@/lib/db/queries/identity";
import { processDocumentWithOcr } from "@/lib/identity/document/process-document";
import { logger } from "@/lib/logging/logger";

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

    // Process document using shared logic
    const result = await processDocumentWithOcr({
      image: input.image,
      requestId: ctx.requestId,
      flowId: ctx.flowId ?? undefined,
      existingDraftId: existingDraft?.id,
      existingDocumentId: existingDraft?.documentId,
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

    // Persist draft with user reference
    await upsertIdentityDraft({
      id: result.draftId,
      userId,
      documentId: result.documentId,
      documentProcessed: result.documentProcessed,
      isDocumentValid: result.isDocumentValid,
      isDuplicateDocument: result.isDuplicateDocument,
      documentType: result.ocrResult?.documentType ?? null,
      issuerCountry: result.issuerCountry,
      documentHash: result.documentHash,
      documentHashField: result.documentHashField,
      nameCommitment: result.ocrResult?.commitments?.nameCommitment ?? null,
      ageClaimHash: result.claimHashes.ageClaimHash,
      docValidityClaimHash: result.claimHashes.docValidityClaimHash,
      nationalityClaimHash: result.claimHashes.nationalityClaimHash,
      confidenceScore: result.ocrResult?.confidence ?? null,
      ocrIssues: result.issues.length ? JSON.stringify(result.issues) : null,
      dobDays: result.parsedDates.dobDays,
    });

    // Create identity_documents record with "pending" status for navigation
    // This allows the user to proceed to liveness verification
    if (result.isDocumentValid && result.ocrResult?.commitments) {
      try {
        await createIdentityDocument({
          id: result.documentId,
          userId,
          documentType: result.ocrResult.documentType ?? null,
          issuerCountry: result.issuerCountry,
          documentHash: result.ocrResult.commitments.documentHash ?? null,
          nameCommitment: result.ocrResult.commitments.nameCommitment ?? null,
          verifiedAt: null,
          confidenceScore: result.ocrResult.confidence ?? null,
          status: "pending",
        });
      } catch (error) {
        // Document might already exist from a previous attempt
        logger.debug(
          { error: String(error), userId, documentId: result.documentId },
          "Identity document already exists or failed to create"
        );
      }
    }

    return {
      success: true,
      draftId: result.draftId,
      documentId: result.documentId,
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
