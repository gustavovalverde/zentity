import "server-only";

import type { QueryResult } from "@zkpassport/sdk";

import crypto from "node:crypto";

import { TRPCError } from "@trpc/server";
import { ZKPassport } from "@zkpassport/sdk";
import { z } from "zod";

import { env } from "@/env";
import { POLICY_VERSION } from "@/lib/blockchain/attestation/policy";
import { insertSignedClaim } from "@/lib/db/queries/crypto";
import {
  createVerification,
  dedupKeyExistsForOtherUser,
  getIdentityBundleByUserId,
  getSelectedVerification,
  isChipVerified,
  isNullifierUsedByOtherUser,
} from "@/lib/db/queries/identity";
import { computeDedupKey } from "@/lib/identity/dedup";
import {
  calculateBirthYearOffsetFromYear,
  dobToDaysSince1900,
  parseBirthYearFromDob,
} from "@/lib/identity/verification/birth-year";
import { scheduleFheEncryption } from "@/lib/privacy/fhe/encryption";
import { signAttestationClaim } from "@/lib/privacy/zk/claims";

import { protectedProcedure, router } from "../server";

let zkPassportInstance: ZKPassport | null = null;

function getZkPassport(): ZKPassport {
  zkPassportInstance ??= new ZKPassport(
    new URL(env.NEXT_PUBLIC_APP_URL).hostname
  );
  return zkPassportInstance;
}

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

      // Verify proofs server-side — this is the trust boundary
      const zkpassport = getZkPassport();
      const devMode =
        env.NEXT_PUBLIC_APP_ENV === "development" ||
        env.NEXT_PUBLIC_APP_ENV === "test";

      const verifyResult = await zkpassport.verify({
        proofs: input.proofs as Parameters<ZKPassport["verify"]>[0]["proofs"],
        queryResult: input.result as QueryResult,
        devMode,
      });

      if (!verifyResult.verified) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Proof verification failed",
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
      if (isChipVerified(existingVerification)) {
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

      const verificationId = crypto.randomUUID();
      const now = new Date().toISOString();

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
          calculateBirthYearOffsetFromYear(parseBirthYearFromDob(birthdate)) ??
          null,
        dedupKey,
        uniqueIdentifier,
        verifiedAt: now,
      });

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
    const bundle = await getIdentityBundleByUserId(ctx.userId);

    return {
      fheComplete: bundle?.fheStatus === "complete",
      fheError: bundle?.fheError ?? null,
    };
  }),
});
