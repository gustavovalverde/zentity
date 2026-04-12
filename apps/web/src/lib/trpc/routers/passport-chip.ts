import "server-only";

import type { ProofResult, QueryResult } from "@zkpassport/utils";

import crypto from "node:crypto";

import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { env } from "@/env";
import { POLICY_VERSION } from "@/lib/blockchain/attestation/policy";
import { POLICY_HASH } from "@/lib/blockchain/attestation/policy-hash";
import { upsertAttestationEvidence } from "@/lib/db/queries/attestation";
import {
  createVerification,
  dedupKeyExistsForOtherUser,
  getIdentityBundleByUserId,
  getSelectedVerification,
  hasProfileSecret,
  isChipVerified,
  isNullifierUsedByOtherUser,
} from "@/lib/db/queries/identity";
import {
  insertProofArtifact,
  insertSignedClaim,
} from "@/lib/db/queries/privacy";
import { computeDedupKey } from "@/lib/identity/dedup";
import {
  calculateBirthYearOffsetFromYear,
  dobToDaysSince1900,
  parseBirthYearFromDob,
} from "@/lib/identity/verification/birth-year";
import { materializeVerificationChecks } from "@/lib/identity/verification/materialize";
import { logger } from "@/lib/logging/logger";
import { scheduleFheEncryption } from "@/lib/privacy/fhe/encryption";
import { signAttestationClaim } from "@/lib/privacy/zk/attestation-claims";
import { computeProofSetHash } from "@/lib/privacy/zk/verification-utils";
import { verifyZkPassportProofs } from "@/lib/privacy/zk/zkpassport-verifier";

import { protectedProcedure, router } from "../server";

function sha256(data: string): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

/**
 * Extract disclosed birthdate string from QueryResult.
 * ZKPassport discloses dates as Date objects.
 */
function extractBirthdate(result: QueryResult): string | undefined {
  const disclosed = result.birthdate?.disclose?.result;
  if (disclosed instanceof Date) {
    return disclosed.toISOString().split("T")[0];
  }
  if (typeof disclosed === "string") {
    return disclosed;
  }
  return undefined;
}

function extractString(
  field: { disclose?: { result?: unknown } } | undefined
): string | undefined {
  const disclosed = field?.disclose?.result;
  return typeof disclosed === "string" ? disclosed : undefined;
}

export const passportChipRouter = router({
  submitResult: protectedProcedure
    .input(
      z.object({
        requestId: z.string(),
        proofs: z.array(z.record(z.string(), z.unknown())),
        result: z.record(z.string(), z.unknown()),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.userId;

      const devMode =
        env.NEXT_PUBLIC_APP_ENV === "development" ||
        env.NEXT_PUBLIC_APP_ENV === "test";
      const domain = new URL(env.NEXT_PUBLIC_APP_URL).hostname;

      const verifyResult = await verifyZkPassportProofs({
        domain,
        proofs: input.proofs as ProofResult[],
        queryResult: input.result as QueryResult,
        devMode,
      });

      if (!verifyResult.verified) {
        logger.warn(
          {
            proofCount: input.proofs.length,
            queryResultErrorKeys: verifyResult.queryResultErrors
              ? Object.keys(verifyResult.queryResultErrors)
              : [],
            verificationTimeMs: Math.round(verifyResult.verificationTimeMs),
          },
          "Passport chip verification failed"
        );
        const details = verifyResult.queryResultErrors
          ? `: ${JSON.stringify(verifyResult.queryResultErrors)}`
          : "";
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Proof verification failed${details}`,
        });
      }

      const uniqueIdentifier = verifyResult.uniqueIdentifier;
      if (!uniqueIdentifier) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No nullifier in verified proofs",
        });
      }

      const [bundle, existingVerification, nullifierUsed] = await Promise.all([
        getIdentityBundleByUserId(userId),
        getSelectedVerification(userId),
        isNullifierUsedByOtherUser(uniqueIdentifier, userId),
      ]);

      if (!bundle?.fheKeyId) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "FHE enrollment required before passport verification",
        });
      }

      // Allow re-submission when user is chip-verified but missing profile secret,
      // only for the SAME passport (nullifier must match to prevent vault/commitment
      // inconsistency — see tamper-model.md)
      const isReVerifyForVault =
        isChipVerified(existingVerification) &&
        !(await hasProfileSecret(userId)) &&
        existingVerification?.uniqueIdentifier === uniqueIdentifier;

      if (isChipVerified(existingVerification) && !isReVerifyForVault) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Passport chip already verified",
        });
      }
      if (nullifierUsed) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "This passport is already registered to another account",
        });
      }

      // Extract from the verified QueryResult — trusted because proofs passed
      const result = input.result as QueryResult;
      const birthdate = extractBirthdate(result);
      const nationality = extractString(result.nationality);
      const fullname = extractString(result.fullname);
      const documentNumber = extractString(result.document_number);
      const documentType = extractString(result.document_type);
      const issuingCountry = extractString(result.issuing_country);

      const nameCommitment = fullname ? sha256(fullname) : null;
      const dobCommitment = birthdate ? sha256(birthdate) : null;
      const nationalityCommitment = nationality ? sha256(nationality) : null;

      const ageVerified = result.age?.gte?.result === true;
      const sanctionsCleared = result.sanctions?.passed === true;
      const faceMatchPassed = result.facematch?.passed ?? null;

      // Cross-method Sybil dedup — same key computation as OCR path
      const dedupCountry = issuingCountry ?? nationality ?? null;
      let dedupKey: string | null = null;
      if (documentNumber && dedupCountry && birthdate) {
        dedupKey = computeDedupKey(
          env.DEDUP_HMAC_SECRET,
          documentNumber,
          dedupCountry,
          birthdate
        );
        const existsForOther = await dedupKeyExistsForOtherUser(
          dedupKey,
          userId
        );
        if (existsForOther) {
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "This identity document is already registered to another account",
          });
        }
      }

      const now = new Date().toISOString();

      // Re-verify for vault: reuse existing verification, skip creation
      const verificationId = isReVerifyForVault
        ? (existingVerification?.id ?? crypto.randomUUID())
        : crypto.randomUUID();

      if (!isReVerifyForVault) {
        await createVerification({
          id: verificationId,
          userId,
          method: "nfc_chip",
          status: "verified",
          documentType: documentType ?? null,
          issuerCountry: issuingCountry ?? null,
          nameCommitment,
          dobCommitment,
          nationalityCommitment,
          livenessScore: 1.0,
          birthYearOffset:
            calculateBirthYearOffsetFromYear(
              parseBirthYearFromDob(birthdate)
            ) ?? null,
          dedupKey,
          uniqueIdentifier,
          verifiedAt: now,
        });
      }

      if (!isReVerifyForVault) {
        // Store signed claim for chip verification results (tamper-evident)
        const chipClaimPayload = {
          type: "chip_verification" as const,
          userId,
          version: 1,
          issuedAt: now,
          policyVersion: POLICY_VERSION,
          data: {
            ageVerified,
            sanctionsCleared,
            faceMatchPassed: faceMatchPassed ?? false,
            livenessScore: 1.0,
            hasNationality: Boolean(nationalityCommitment),
            hasName: Boolean(nameCommitment),
            hasDob: Boolean(dobCommitment),
          },
        };
        const chipClaimSignature = await signAttestationClaim(chipClaimPayload);
        await insertSignedClaim({
          id: crypto.randomUUID(),
          userId,
          verificationId,
          claimType: "chip_verification",
          claimPayload: JSON.stringify(chipClaimPayload),
          signature: chipClaimSignature,
          issuedAt: now,
        });

        // Store each ZKPassport proof in proof_artifacts
        const proofHashes: string[] = [];
        const proofs = input.proofs as ProofResult[];
        for (const proofResult of proofs) {
          const proofPayload = proofResult.proof ?? "";
          const proofHash = crypto
            .createHash("sha256")
            .update(proofPayload)
            .digest("hex");
          proofHashes.push(proofHash);

          await insertProofArtifact({
            id: crypto.randomUUID(),
            userId,
            verificationId,
            proofSystem: "zkpassport",
            proofType: proofResult.name ?? "zkpassport",
            proofHash,
            proofPayload,
            verified: true,
            policyVersion: POLICY_VERSION,
            metadata: JSON.stringify({
              vkeyHash: proofResult.vkeyHash,
              version: proofResult.version,
              requestId: input.requestId,
            }),
          });
        }

        // Compute proofSetHash and upsert attestation evidence
        if (proofHashes.length > 0) {
          const proofSetHash = computeProofSetHash({
            proofHashes,
            policyHash: POLICY_HASH,
          });
          await upsertAttestationEvidence({
            userId,
            verificationId,
            policyVersion: POLICY_VERSION,
            policyHash: POLICY_HASH,
            proofSetHash,
          });
        }

        await materializeVerificationChecks(userId, verificationId);

        // Convert DOB to dobDays for FHE encryption
        const dobDays = dobToDaysSince1900(birthdate);

        // Schedule FHE encryption (fire-and-forget)
        // Chip NFC challenge-response proves physical possession → synthetic liveness 1.0
        scheduleFheEncryption({
          userId,
          dobDays: dobDays ?? null,
          livenessScore: 1.0,
          requestId: ctx.requestId,
          flowId: ctx.flowId ?? undefined,
          reason: "passport_chip_verified",
        });
      }

      return {
        verificationId,
        chipVerified: true,
        // Disclosed PII for client-side vault storage.
        // These are transient — only returned once, never stored in plaintext.
        disclosed: {
          fullName: fullname ?? null,
          dateOfBirth: birthdate ?? null,
          nationality: nationality ?? null,
          nationalityCode: nationality ?? null,
          documentType: documentType ?? null,
          issuingCountry: issuingCountry ?? null,
        },
      };
    }),

  status: protectedProcedure.query(async ({ ctx }) => {
    const [bundle, profileSecretStored] = await Promise.all([
      getIdentityBundleByUserId(ctx.userId),
      hasProfileSecret(ctx.userId),
    ]);

    return {
      fheComplete: bundle?.fheStatus === "complete",
      fheError: bundle?.fheError ?? null,
      profileSecretStored,
    };
  }),
});
