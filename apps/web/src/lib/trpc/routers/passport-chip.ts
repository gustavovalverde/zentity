import "server-only";

import type { QueryResult } from "@zkpassport/sdk";

import crypto from "node:crypto";

import { TRPCError } from "@trpc/server";
import { z } from "zod";

import {
  getIdentityBundleByUserId,
  upsertIdentityBundle,
} from "@/lib/db/queries/identity";
import {
  createPassportChipVerification,
  hasVerifiedChipVerification,
  isNullifierUsedByOtherUser,
} from "@/lib/db/queries/passport-chip";
import { dobToDaysSince1900 } from "@/lib/identity/verification/birth-year";
import { scheduleFheEncryption } from "@/lib/privacy/fhe/encryption";

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
        uniqueIdentifier: z.string(),
        result: z.record(z.string(), z.unknown()),
        faceMatchAvailable: z.boolean(),
        faceMatchPassed: z.boolean().nullable(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.userId;

      const [bundle, alreadyVerified, nullifierUsed] = await Promise.all([
        getIdentityBundleByUserId(userId),
        hasVerifiedChipVerification(userId),
        isNullifierUsedByOtherUser(input.uniqueIdentifier, userId),
      ]);

      if (!bundle?.fheKeyId) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "FHE enrollment required before passport verification",
        });
      }
      if (alreadyVerified) {
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

      const result = input.result as QueryResult;

      // Extract all disclosed fields
      const birthdate = extractBirthdate(result);
      const nationality = extractString(result.nationality);
      const fullname = extractString(result.fullname);
      const documentType = extractString(result.document_type);
      const issuingCountry = extractString(result.issuing_country);

      // Compute commitments (hashes — never store raw PII)
      const nameCommitment = fullname ? sha256(fullname) : null;
      const dobCommitment = birthdate ? sha256(birthdate) : null;
      const nationalityCommitment = nationality ? sha256(nationality) : null;

      const ageVerified = result.age?.gte?.result === true;
      const sanctionsCleared = result.sanctions?.passed === true;

      const verificationId = crypto.randomUUID();
      const now = new Date().toISOString();

      const verification = await createPassportChipVerification({
        id: verificationId,
        userId,
        uniqueIdentifier: input.uniqueIdentifier,
        requestId: input.requestId,
        status: "verified",
        ageVerified,
        sanctionsCleared,
        faceMatchAvailable: input.faceMatchAvailable,
        faceMatchPassed: input.faceMatchPassed,
        nameCommitment,
        dobCommitment,
        nationalityCommitment,
        documentType: documentType ?? null,
        issuingCountry: issuingCountry ?? null,
        verifiedAt: now,
      });

      // Link to identity bundle
      await upsertIdentityBundle({
        userId,
        chipVerificationId: verification.id,
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
        verificationId: verification.id,
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
