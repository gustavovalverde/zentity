import type {
  FheStatus,
  VerifyIdentityResponse,
} from "./helpers/job-processor";

import crypto from "node:crypto";

import { TRPCError } from "@trpc/server";
import { v4 as uuidv4 } from "uuid";
import z from "zod";

import { getDocumentHashField } from "@/lib/blockchain/attestation/claim-hash";
import { ISSUER_ID, POLICY_VERSION } from "@/lib/blockchain/attestation/policy";
import {
  getSessionFromCookie,
  validateStepAccess,
} from "@/lib/db/onboarding-session";
import {
  createIdentityDocument,
  documentHashExists,
  getLatestIdentityDocumentByUserId,
  getSelectedIdentityDocumentByUserId,
  upsertIdentityBundle,
} from "@/lib/db/queries/identity";
import { processDocumentOcr } from "@/lib/identity/document/ocr-client";
import { dobToDaysSince1900 } from "@/lib/identity/verification/birth-year";
import {
  computeClaimHashes,
  storeVerificationClaims,
} from "@/lib/identity/verification/claims-signing";
import { countryCodeToNumeric } from "@/lib/identity/verification/compliance";
import { validateFaces } from "@/lib/identity/verification/face-validation";
import { logger } from "@/lib/logging/logger";
import { sha256CommitmentHex } from "@/lib/privacy/crypto/commitments";
import { scheduleFheEncryption } from "@/lib/privacy/crypto/fhe-encryption";
import { getNationalityCode } from "@/lib/privacy/zk/nationality-data";

import { protectedProcedure } from "../../server";
import { generateNameCommitment, parseDateToInt } from "./helpers/date-parsing";
import { invalidateVerificationCache } from "./helpers/verification-cache";

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
export const verifyProcedure = protectedProcedure
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
    const userSalt = input.userSalt;
    const fheKeyId = input.fheKeyId;
    const hasFheKeyMaterial = Boolean(fheKeyId);

    // Parallelize independent operations: existing doc lookup, OCR, and face validation
    // OCR (~2-5s) and face validation (~500-1000ms) are independent - both use raw input images
    const [existingDocument, ocrResult, faceValidation] = await Promise.all([
      getLatestIdentityDocumentByUserId(userId),
      processDocumentOcr({
        image: input.documentImage,
        userSalt,
        requestId: ctx.requestId,
        flowId: ctx.flowId ?? undefined,
      }).catch((error) => {
        logger.error(
          { error: String(error), requestId: ctx.requestId, userId },
          "Document OCR processing failed in verify"
        );
        return null;
      }),
      validateFaces(input.selfieImage, input.documentImage),
    ]);

    // Process OCR result and collect issues
    const documentResult = ocrResult;
    if (documentResult) {
      issues.push(...(documentResult.validationIssues || []));
    } else {
      issues.push("document_processing_failed");
    }
    issues.push(...faceValidation.issues);

    // Check for duplicate document (depends on OCR result)
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

    const documentProcessed = Boolean(documentResult?.commitments);
    const identityDocumentId = documentProcessed ? uuidv4() : null;
    const documentHash = documentResult?.commitments?.documentHash ?? null;
    let documentHashField: string | null = null;
    if (documentHash) {
      try {
        documentHashField = getDocumentHashField(documentHash);
      } catch (error) {
        logger.error(
          { error: String(error), documentHash },
          "Failed to generate document hash field"
        );
        issues.push("document_hash_field_failed");
      }
    }

    // Compute claim hashes and store signed claims
    const dateOfBirth = documentResult?.extractedData?.dateOfBirth ?? null;
    const dobDays = dateOfBirth
      ? (dobToDaysSince1900(dateOfBirth) ?? null)
      : null;
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
        dobDays,
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
    const docValidityProofGenerated = false;
    const nationalityCommitmentGenerated = Boolean(nationalityCommitment);
    const countryCodeEncrypted = false;
    const livenessScoreEncrypted = false;
    const fheStatus: FheStatus = hasFheKeyMaterial ? "pending" : "error";
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
      const dateOfBirth = documentResult?.extractedData?.dateOfBirth;

      // Full DOB as days since 1900-01-01 - provides day-level precision
      const dobDays = dobToDaysSince1900(dateOfBirth);

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
        dobDays: dobDays ?? null,
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
  });

/**
 * Verifies a claimed name against the stored commitment.
 * Uses constant-time comparison to prevent timing attacks.
 * Does not reveal the actual stored name.
 */
export const verifyNameProcedure = protectedProcedure
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
  });
