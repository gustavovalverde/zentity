import "server-only";

import { and, eq, sql } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";

import {
  computeClaimHash,
  getDocumentHashField,
} from "@/lib/blockchain/attestation/claim-hash";
import { ISSUER_ID, POLICY_VERSION } from "@/lib/blockchain/attestation/policy";
import { db } from "@/lib/db/connection";
import { insertSignedClaim } from "@/lib/db/queries/crypto";
import {
  createIdentityDocument,
  getIdentityDraftById,
  getIdentityVerificationJobById,
  updateIdentityDraft,
  updateIdentityVerificationJobStatus,
  upsertIdentityBundle,
} from "@/lib/db/queries/identity";
import { identityVerificationJobs } from "@/lib/db/schema/identity";
import { FACE_MATCH_MIN_CONFIDENCE } from "@/lib/identity/liveness/policy";
import { logger } from "@/lib/logging/logger";
import { hashIdentifier, withSpan } from "@/lib/observability/telemetry";
import { signAttestationClaim } from "@/lib/privacy/crypto/signed-claims";

import { invalidateVerificationCache } from "./verification-cache";

/** Status of FHE encryption operations */
export type FheStatus = "pending" | "complete" | "error";

export interface VerifyIdentityResponse {
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
  fheStatus?: FheStatus;
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

const activeIdentityJobs = new Set<string>();

export function scheduleIdentityJob(jobId: string): void {
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

export function processIdentityVerificationJob(jobId: string): Promise<void> {
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
      if (job?.status !== "running" || job.startedAt !== claimTime) {
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
            documentHashField = getDocumentHashField(documentHash);
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

        const countryCodeEncrypted = false;
        const livenessScoreEncrypted = false;
        const fheStatus: FheStatus = job.fheKeyId ? "pending" : "error";
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

        invalidateVerificationCache(job.userId);

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
