import "server-only";

import crypto from "node:crypto";

import { encryptBatchFhe, FheServiceError } from "@/lib/crypto/fhe-client";
import {
  getLatestEncryptedAttributeByUserAndType,
  insertEncryptedAttribute,
} from "@/lib/db/queries/crypto";
import {
  getIdentityBundleByUserId,
  getLatestIdentityDraftByUserAndDocument,
  getLatestIdentityDraftByUserId,
  getSelectedIdentityDocumentByUserId,
  getVerificationStatus,
  updateIdentityBundleFheStatus,
} from "@/lib/db/queries/identity";
import { getComplianceLevel } from "@/lib/identity/compliance";
import { logger } from "@/lib/logging/logger";
import { hashIdentifier, withSpan } from "@/lib/observability/telemetry";

export interface FheEncryptionSchedule {
  userId: string;
  requestId?: string;
  flowId?: string;
  reason?: string;
}

const activeFheJobs = new Set<string>();
const pendingContexts = new Map<
  string,
  Omit<FheEncryptionSchedule, "userId">
>();

function shouldEncryptWithKey(
  existing: { keyId: string | null } | null,
  keyId: string
): boolean {
  if (!existing) {
    return true;
  }
  if (existing.keyId && existing.keyId !== keyId) {
    return true;
  }
  if (!existing.keyId && keyId) {
    return true;
  }
  return false;
}

async function runFheEncryption(
  userId: string,
  context: Omit<FheEncryptionSchedule, "userId"> | undefined
): Promise<void> {
  await withSpan(
    "fhe.encryption_job",
    {
      "identity.user_id_hash": hashIdentifier(userId),
      "fhe.reason": context?.reason,
    },
    async (span) => {
      const bundle = getIdentityBundleByUserId(userId);
      const keyId = bundle?.fheKeyId ?? null;
      if (!keyId) {
        updateIdentityBundleFheStatus({
          userId,
          fheStatus: "error",
          fheError: "fhe_key_missing",
        });
        span.setAttribute("fhe.key_missing", true);
        return;
      }

      span.setAttribute("fhe.key_id_hash", hashIdentifier(keyId));

      const selectedDocument = getSelectedIdentityDocumentByUserId(userId);
      const draft = selectedDocument
        ? getLatestIdentityDraftByUserAndDocument(userId, selectedDocument.id)
        : getLatestIdentityDraftByUserId(userId);

      const birthYearOffset =
        draft?.birthYearOffset ?? selectedDocument?.birthYearOffset ?? null;
      const countryCodeNumeric = draft?.countryCodeNumeric ?? 0;
      const livenessScore = draft?.antispoofScore;

      const verificationStatus = getVerificationStatus(userId);
      const complianceLevel = verificationStatus.verified
        ? getComplianceLevel(verificationStatus)
        : null;

      const existingBirthYearOffset = getLatestEncryptedAttributeByUserAndType(
        userId,
        "birth_year_offset"
      );
      const existingCountryCode = getLatestEncryptedAttributeByUserAndType(
        userId,
        "country_code"
      );
      const existingLivenessScore = getLatestEncryptedAttributeByUserAndType(
        userId,
        "liveness_score"
      );
      const existingCompliance = getLatestEncryptedAttributeByUserAndType(
        userId,
        "compliance_level"
      );

      const shouldEncryptBirthYearOffset =
        birthYearOffset !== null &&
        birthYearOffset !== undefined &&
        shouldEncryptWithKey(existingBirthYearOffset, keyId);
      const shouldEncryptCountryCode =
        countryCodeNumeric > 0 &&
        shouldEncryptWithKey(existingCountryCode, keyId);
      const shouldEncryptLivenessScore =
        typeof livenessScore === "number" &&
        Number.isFinite(livenessScore) &&
        shouldEncryptWithKey(existingLivenessScore, keyId);
      const shouldEncryptCompliance =
        complianceLevel !== null &&
        shouldEncryptWithKey(existingCompliance, keyId);

      span.setAttribute(
        "fhe.request_birth_year_offset",
        shouldEncryptBirthYearOffset
      );
      span.setAttribute("fhe.request_country_code", shouldEncryptCountryCode);
      span.setAttribute(
        "fhe.request_liveness_score",
        shouldEncryptLivenessScore
      );
      span.setAttribute(
        "fhe.request_compliance_level",
        shouldEncryptCompliance
      );

      const needsEncryption =
        shouldEncryptBirthYearOffset ||
        shouldEncryptCountryCode ||
        shouldEncryptLivenessScore ||
        shouldEncryptCompliance;

      if (!needsEncryption) {
        updateIdentityBundleFheStatus({
          userId,
          fheStatus: verificationStatus.verified ? "complete" : "pending",
          fheError: null,
          fheKeyId: keyId,
        });
        span.setAttribute("fhe.encryption_skipped", true);
        return;
      }

      updateIdentityBundleFheStatus({
        userId,
        fheStatus: "pending",
        fheError: null,
        fheKeyId: keyId,
      });

      const startTime = Date.now();
      try {
        const result = await encryptBatchFhe({
          keyId,
          birthYearOffset: shouldEncryptBirthYearOffset
            ? (birthYearOffset ?? undefined)
            : undefined,
          countryCode: shouldEncryptCountryCode
            ? countryCodeNumeric
            : undefined,
          livenessScore: shouldEncryptLivenessScore ? livenessScore : undefined,
          complianceLevel: shouldEncryptCompliance
            ? complianceLevel
            : undefined,
          requestId: context?.requestId,
          flowId: context?.flowId,
        });
        const durationMs = Date.now() - startTime;

        const missingCiphertexts: string[] = [];

        if (shouldEncryptBirthYearOffset) {
          if (result.birthYearOffsetCiphertext) {
            insertEncryptedAttribute({
              id: crypto.randomUUID(),
              userId,
              source: "web2_tfhe",
              attributeType: "birth_year_offset",
              ciphertext: result.birthYearOffsetCiphertext,
              keyId,
              encryptionTimeMs: durationMs,
            });
          } else {
            missingCiphertexts.push("birth_year_offset");
          }
        }

        if (shouldEncryptCountryCode) {
          if (result.countryCodeCiphertext) {
            insertEncryptedAttribute({
              id: crypto.randomUUID(),
              userId,
              source: "web2_tfhe",
              attributeType: "country_code",
              ciphertext: result.countryCodeCiphertext,
              keyId,
              encryptionTimeMs: durationMs,
            });
          } else {
            missingCiphertexts.push("country_code");
          }
        }

        if (shouldEncryptLivenessScore) {
          if (result.livenessScoreCiphertext) {
            insertEncryptedAttribute({
              id: crypto.randomUUID(),
              userId,
              source: "web2_tfhe",
              attributeType: "liveness_score",
              ciphertext: result.livenessScoreCiphertext,
              keyId,
              encryptionTimeMs: durationMs,
            });
          } else {
            missingCiphertexts.push("liveness_score");
          }
        }

        if (shouldEncryptCompliance) {
          if (result.complianceLevelCiphertext) {
            insertEncryptedAttribute({
              id: crypto.randomUUID(),
              userId,
              source: "web2_tfhe",
              attributeType: "compliance_level",
              ciphertext: result.complianceLevelCiphertext,
              keyId,
              encryptionTimeMs: durationMs,
            });
          } else {
            missingCiphertexts.push("compliance_level");
          }
        }

        if (missingCiphertexts.length > 0) {
          updateIdentityBundleFheStatus({
            userId,
            fheStatus: "error",
            fheError: "fhe_encryption_failed",
            fheKeyId: keyId,
          });
          span.setAttribute("fhe.missing_ciphertexts", missingCiphertexts);
          return;
        }

        updateIdentityBundleFheStatus({
          userId,
          fheStatus: verificationStatus.verified ? "complete" : "pending",
          fheError: null,
          fheKeyId: keyId,
        });
        span.setAttribute("fhe.encryption_ms", durationMs);
      } catch (error) {
        const isHttp =
          error instanceof FheServiceError && error.kind === "http";
        const issue = isHttp
          ? "fhe_encryption_failed"
          : "fhe_service_unavailable";
        updateIdentityBundleFheStatus({
          userId,
          fheStatus: "error",
          fheError: issue,
          fheKeyId: keyId,
        });
        span.setAttribute("fhe.encryption_error", issue);
        if (error instanceof Error) {
          span.recordException(error);
        }
        logger.warn(
          {
            error: error instanceof Error ? error.message : String(error),
            userId: hashIdentifier(userId),
            issue,
          },
          "FHE encryption job failed"
        );
      }
    }
  );
}

export function scheduleFheEncryption(args: FheEncryptionSchedule): void {
  pendingContexts.set(args.userId, {
    requestId: args.requestId,
    flowId: args.flowId,
    reason: args.reason,
  });
  if (activeFheJobs.has(args.userId)) {
    return;
  }
  activeFheJobs.add(args.userId);
  setTimeout(() => {
    (async () => {
      while (pendingContexts.has(args.userId)) {
        const context = pendingContexts.get(args.userId);
        pendingContexts.delete(args.userId);
        await runFheEncryption(args.userId, context);
      }
    })()
      .catch((error) => {
        logger.warn(
          {
            error: error instanceof Error ? error.message : String(error),
            userId: hashIdentifier(args.userId),
          },
          "FHE encryption scheduler failed"
        );
      })
      .finally(() => {
        activeFheJobs.delete(args.userId);
        if (pendingContexts.has(args.userId)) {
          const context = pendingContexts.get(args.userId);
          if (context) {
            scheduleFheEncryption({ userId: args.userId, ...context });
          }
        }
      });
  }, 0);
}
