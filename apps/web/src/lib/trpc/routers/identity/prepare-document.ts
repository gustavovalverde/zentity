import { TRPCError } from "@trpc/server";
import { v4 as uuidv4 } from "uuid";
import z from "zod";

import {
  computeClaimHash,
  getDocumentHashField,
} from "@/lib/blockchain/attestation/claim-hash";
import {
  getSessionFromCookie,
  updateWizardProgress,
  validateStepAccess,
} from "@/lib/db/onboarding-session";
import {
  documentHashExists,
  getIdentityDraftById,
  getIdentityDraftBySessionId,
  upsertIdentityDraft,
} from "@/lib/db/queries/identity";
import { processDocumentOcr } from "@/lib/identity/document/ocr-client";
import { logger } from "@/lib/logging/logger";
import { getNationalityCode } from "@/lib/privacy/zk/nationality-data";

import { publicProcedure } from "../../server";
import { parseBirthYear, parseDateToInt } from "./helpers/date-parsing";

/**
 * OCR + draft creation for onboarding.
 *
 * Performs document OCR, computes commitments, and persists a draft that can be
 * finalized later once the user account exists.
 */
export const prepareDocumentProcedure = publicProcedure
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

    const issues: string[] = [];
    const sessionId = validation.session.id;

    // Parallelize OCR and draft lookup - they are independent operations
    const [ocrResult, existingDraft] = await Promise.all([
      processDocumentOcr({
        image: input.image,
        requestId: ctx.requestId,
        flowId: ctx.flowId ?? undefined,
      }).catch((error) => {
        logger.error(
          { error: String(error), requestId: ctx.requestId },
          "Document OCR processing failed in prepareDocument"
        );
        return null;
      }),
      validation.session.identityDraftId !== null &&
      validation.session.identityDraftId !== undefined
        ? getIdentityDraftById(validation.session.identityDraftId)
        : getIdentityDraftBySessionId(sessionId),
    ]);

    // Process OCR result
    const documentResult = ocrResult;
    if (documentResult) {
      issues.push(...(documentResult.validationIssues || []));
    } else {
      issues.push("document_processing_failed");
    }

    const draftId = existingDraft?.id ?? uuidv4();
    const documentId = existingDraft?.documentId ?? uuidv4();

    const documentProcessed = Boolean(documentResult?.commitments);
    const documentHash = documentResult?.commitments?.documentHash ?? null;
    let documentHashField: string | null = null;
    if (documentHash) {
      try {
        documentHashField = getDocumentHashField(documentHash);
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

    ctx.span?.setAttribute("onboarding.document_processed", documentProcessed);
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
  });
