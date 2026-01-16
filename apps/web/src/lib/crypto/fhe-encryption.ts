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
import {
  countryCodeToNumeric,
  getComplianceLevel,
} from "@/lib/identity/compliance";
import { logger } from "@/lib/logging/logger";
import { hashIdentifier, withSpan } from "@/lib/observability/telemetry";

export interface FheEncryptionSchedule {
  userId: string;
  requestId?: string;
  flowId?: string;
  reason?: string;
  birthYearOffset?: number | null;
  countryCodeNumeric?: number | null;
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
      const bundle = await getIdentityBundleByUserId(userId);
      const keyId = bundle?.fheKeyId ?? null;
      if (!keyId) {
        await updateIdentityBundleFheStatus({
          userId,
          fheStatus: "error",
          fheError: "fhe_key_missing",
        });
        span.setAttribute("fhe.key_missing", true);
        return;
      }

      span.setAttribute("fhe.key_id_hash", hashIdentifier(keyId));

      const selectedDocument =
        await getSelectedIdentityDocumentByUserId(userId);
      const draft = selectedDocument
        ? await getLatestIdentityDraftByUserAndDocument(
            userId,
            selectedDocument.id
          )
        : await getLatestIdentityDraftByUserId(userId);

      // Resolve birthYearOffset: context > draft fallback
      const birthYearOffset = (() => {
        if (typeof context?.birthYearOffset === "number") {
          return context.birthYearOffset;
        }
        if (typeof draft?.birthYearOffset === "number") {
          return draft.birthYearOffset;
        }
        return null;
      })();
      // Resolve countryCodeNumeric: context > draft.issuerCountry conversion
      const countryCodeNumeric = (() => {
        if (typeof context?.countryCodeNumeric === "number") {
          return context.countryCodeNumeric;
        }
        if (draft?.issuerCountry) {
          return countryCodeToNumeric(draft.issuerCountry);
        }
        return null;
      })();
      const livenessScore = draft?.antispoofScore;

      const verificationStatus = await getVerificationStatus(userId);
      const complianceLevel = verificationStatus.verified
        ? getComplianceLevel(verificationStatus)
        : null;

      // Parallelize independent attribute lookups
      const [
        existingBirthYearOffset,
        existingCountryCode,
        existingLivenessScore,
        existingCompliance,
      ] = await Promise.all([
        getLatestEncryptedAttributeByUserAndType(userId, "birth_year_offset"),
        getLatestEncryptedAttributeByUserAndType(userId, "country_code"),
        getLatestEncryptedAttributeByUserAndType(userId, "liveness_score"),
        getLatestEncryptedAttributeByUserAndType(userId, "compliance_level"),
      ]);

      const hasBirthYearOffsetValue =
        typeof birthYearOffset === "number" &&
        Number.isInteger(birthYearOffset) &&
        birthYearOffset >= 0 &&
        birthYearOffset <= 255;
      const hasCountryCodeValue =
        typeof countryCodeNumeric === "number" &&
        Number.isInteger(countryCodeNumeric) &&
        countryCodeNumeric > 0;

      const shouldEncryptBirthYearOffset =
        hasBirthYearOffsetValue &&
        shouldEncryptWithKey(existingBirthYearOffset, keyId);
      const shouldEncryptCountryCode =
        hasCountryCodeValue && shouldEncryptWithKey(existingCountryCode, keyId);
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
        const missingBirthYearOffset = !(
          hasBirthYearOffsetValue || existingBirthYearOffset
        );
        const missingCountryCode = !(
          hasCountryCodeValue || existingCountryCode
        );
        const missingInputs = missingBirthYearOffset || missingCountryCode;
        await updateIdentityBundleFheStatus({
          userId,
          fheStatus:
            verificationStatus.verified && !missingInputs
              ? "complete"
              : "pending",
          fheError: null,
          fheKeyId: keyId,
        });
        span.setAttribute("fhe.encryption_skipped", true);
        span.setAttribute("fhe.inputs_missing", missingInputs);
        return;
      }

      await updateIdentityBundleFheStatus({
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
            await insertEncryptedAttribute({
              id: crypto.randomUUID(),
              userId,
              source: "web2_tfhe",
              attributeType: "birth_year_offset",
              ciphertext: Buffer.from(result.birthYearOffsetCiphertext),
              keyId,
              encryptionTimeMs: durationMs,
            });
          } else {
            missingCiphertexts.push("birth_year_offset");
          }
        }

        if (shouldEncryptCountryCode) {
          if (result.countryCodeCiphertext) {
            await insertEncryptedAttribute({
              id: crypto.randomUUID(),
              userId,
              source: "web2_tfhe",
              attributeType: "country_code",
              ciphertext: Buffer.from(result.countryCodeCiphertext),
              keyId,
              encryptionTimeMs: durationMs,
            });
          } else {
            missingCiphertexts.push("country_code");
          }
        }

        if (shouldEncryptLivenessScore) {
          if (result.livenessScoreCiphertext) {
            await insertEncryptedAttribute({
              id: crypto.randomUUID(),
              userId,
              source: "web2_tfhe",
              attributeType: "liveness_score",
              ciphertext: Buffer.from(result.livenessScoreCiphertext),
              keyId,
              encryptionTimeMs: durationMs,
            });
          } else {
            missingCiphertexts.push("liveness_score");
          }
        }

        if (shouldEncryptCompliance) {
          if (result.complianceLevelCiphertext) {
            await insertEncryptedAttribute({
              id: crypto.randomUUID(),
              userId,
              source: "web2_tfhe",
              attributeType: "compliance_level",
              ciphertext: Buffer.from(result.complianceLevelCiphertext),
              keyId,
              encryptionTimeMs: durationMs,
            });
          } else {
            missingCiphertexts.push("compliance_level");
          }
        }

        if (missingCiphertexts.length > 0) {
          await updateIdentityBundleFheStatus({
            userId,
            fheStatus: "error",
            fheError: "fhe_encryption_failed",
            fheKeyId: keyId,
          });
          span.setAttribute("fhe.missing_ciphertexts", missingCiphertexts);
          return;
        }

        await updateIdentityBundleFheStatus({
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
        await updateIdentityBundleFheStatus({
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
    birthYearOffset: args.birthYearOffset ?? undefined,
    countryCodeNumeric: args.countryCodeNumeric ?? undefined,
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
