import "server-only";

import type { ProofResult, QueryResult } from "@zkpassport/utils";

import crypto from "node:crypto";

import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { env } from "@/env";
import { POLICY_VERSION } from "@/lib/blockchain/attestation/policy";
import { POLICY_HASH } from "@/lib/blockchain/attestation/policy-hash";
import { db } from "@/lib/db/connection";
import { upsertAttestationEvidence } from "@/lib/db/queries/attestation";
import {
  consumeIdentityVerificationSession,
  createIdentityVerificationSession,
  createVerification,
  getAccountIdentity,
  getIdentityBundleByUserId,
  getIdentityVerificationSessionById,
  hasProfileSecret,
  isChipVerified,
  isNullifierUsedByOtherUser,
  reconcileIdentityBundle,
  resolveDedupKeyForUser,
} from "@/lib/db/queries/identity";
import {
  insertProofArtifact,
  insertSignedClaim,
} from "@/lib/db/queries/privacy";
import { recordValidityTransition } from "@/lib/identity/validity/transition";
import {
  calculateBirthYearOffsetFromYear,
  dobToDaysSince1900,
  parseBirthYearFromDob,
} from "@/lib/identity/verification/birth-year";
import {
  computeNullifierSeed,
  NULLIFIER_SEED_SOURCE,
} from "@/lib/identity/verification/dedup";
import { materializeVerificationChecks } from "@/lib/identity/verification/materialize";
import { logger } from "@/lib/logging/logger";
import { scheduleFheEncryption } from "@/lib/privacy/fhe/encryption";
import { signAttestationClaim } from "@/lib/privacy/zk/attestation-claims";
import { computeProofSetHash } from "@/lib/privacy/zk/proof-verification";
import { verifyZkPassportProofs } from "@/lib/privacy/zk/zkpassport-verifier";

import { protectedProcedure, router } from "../server";

function sha256(data: string): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

const PASSPORT_CHIP_SESSION_TTL_MS = 10 * 60 * 1000;
const PASSPORT_CHIP_PROOF_SCOPE = "zentity:nfc-chip:identity-verification:v1";
const PASSPORT_CHIP_QUERY_PROFILE = "passport-chip-v1";

function buildProofBinding(sessionId: string): string {
  return `zentity:nfc-chip:${sessionId}:${crypto.randomBytes(16).toString("hex")}`;
}

function expectedQueryHash(): string {
  return sha256(
    JSON.stringify({
      profile: PASSPORT_CHIP_QUERY_PROFILE,
      minAge: 18,
      disclosures: [
        "birthdate",
        "nationality",
        "fullname",
        "document_type",
        "issuing_country",
      ],
      sanctions: "all",
      facematch: "strict-when-supported",
      bind: "custom_data",
      scope: PASSPORT_CHIP_PROOF_SCOPE,
    })
  );
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
  createSession: protectedProcedure.mutation(async ({ ctx }) => {
    const now = Date.now();
    const id = crypto.randomUUID();
    const session = await createIdentityVerificationSession({
      id,
      userId: ctx.userId,
      method: "nfc_chip",
      provider: "zkpassport",
      status: "pending",
      proofScope: PASSPORT_CHIP_PROOF_SCOPE,
      proofBinding: buildProofBinding(id),
      queryHash: expectedQueryHash(),
      createdAt: now,
      expiresAt: now + PASSPORT_CHIP_SESSION_TTL_MS,
      consumedAt: null,
      requestId: null,
      verificationId: null,
    });

    return {
      verificationSessionId: session.id,
      proofScope: session.proofScope,
      proofBinding: session.proofBinding,
      expiresAt: session.expiresAt,
    };
  }),

  submitResult: protectedProcedure
    .input(
      z.object({
        verificationSessionId: z.string().min(1),
        requestId: z.string(),
        proofs: z.array(z.record(z.string(), z.unknown())),
        result: z.record(z.string(), z.unknown()),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.userId;
      const verificationSession = await getIdentityVerificationSessionById(
        input.verificationSessionId
      );
      if (
        !verificationSession ||
        verificationSession.userId !== userId ||
        verificationSession.method !== "nfc_chip" ||
        verificationSession.provider !== "zkpassport"
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Invalid passport chip verification session",
        });
      }
      if (verificationSession.consumedAt) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Passport chip verification session already used",
        });
      }
      if (verificationSession.expiresAt < Date.now()) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Passport chip verification session expired",
        });
      }
      if (verificationSession.queryHash !== expectedQueryHash()) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Passport chip verification query profile mismatch",
        });
      }

      const devMode =
        env.NEXT_PUBLIC_APP_ENV === "development" ||
        env.NEXT_PUBLIC_APP_ENV === "test";
      const domain = new URL(env.NEXT_PUBLIC_APP_URL).hostname;
      const result = input.result as QueryResult;
      if (result.bind?.custom_data !== verificationSession.proofBinding) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Passport chip proof is not bound to this session",
        });
      }

      const verifyResult = await verifyZkPassportProofs({
        domain,
        proofs: input.proofs as ProofResult[],
        queryResult: result,
        devMode,
        scope: verificationSession.proofScope,
        validity: Math.floor(PASSPORT_CHIP_SESSION_TTL_MS / 1000),
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

      const chipNullifier = verifyResult.chipNullifier;
      if (!chipNullifier) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No nullifier in verified proofs",
        });
      }

      const [accountIdentity, nullifierUsed] = await Promise.all([
        getAccountIdentity(userId),
        isNullifierUsedByOtherUser(chipNullifier, userId),
      ]);
      const bundle = accountIdentity.bundle;
      const existingVerification = accountIdentity.effectiveVerification;

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
        existingVerification?.chipNullifier === chipNullifier;

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

      const { dedupKey, duplicateForOther } = await resolveDedupKeyForUser({
        secret: env.DEDUP_HMAC_SECRET,
        userId,
        docNumber: documentNumber,
        country: issuingCountry ?? nationality ?? null,
        dob: birthdate,
      });
      if (duplicateForOther) {
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "This identity document is already registered to another account",
        });
      }

      const nullifierSeed = computeNullifierSeed(
        env.DEDUP_HMAC_SECRET,
        chipNullifier,
        NULLIFIER_SEED_SOURCE.NFC
      );

      const now = new Date().toISOString();

      // Re-verify for vault: reuse existing verification, skip creation
      const verificationId = isReVerifyForVault
        ? (existingVerification?.id ?? crypto.randomUUID())
        : crypto.randomUUID();

      if (!isReVerifyForVault) {
        await db.transaction(async (tx) => {
          await createVerification(
            {
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
              chipNullifier,
              nullifierSeed,
              verifiedAt: now,
            },
            tx
          );

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
          const chipClaimSignature =
            await signAttestationClaim(chipClaimPayload);
          await insertSignedClaim(
            {
              id: crypto.randomUUID(),
              userId,
              verificationId,
              claimType: "chip_verification",
              claimPayload: JSON.stringify(chipClaimPayload),
              signature: chipClaimSignature,
              issuedAt: now,
            },
            tx
          );

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

            await insertProofArtifact(
              {
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
              },
              tx
            );
          }

          if (proofHashes.length > 0) {
            const proofSetHash = computeProofSetHash({
              proofHashes,
              policyHash: POLICY_HASH,
            });
            await upsertAttestationEvidence(
              {
                userId,
                verificationId,
                policyVersion: POLICY_VERSION,
                policyHash: POLICY_HASH,
                proofSetHash,
              },
              tx
            );
          }

          await materializeVerificationChecks(userId, verificationId, tx);
          await consumeIdentityVerificationSession(
            {
              id: verificationSession.id,
              requestId: input.requestId,
              verificationId,
            },
            tx
          );
          const reconcileResult = await reconcileIdentityBundle(userId, tx);
          await recordValidityTransition({
            executor: tx,
            userId,
            verificationId,
            eventKind: reconcileResult.credentialSuperseded
              ? "superseded"
              : "verified",
            source: "system",
            occurredAt: now,
          });
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
      }

      if (isReVerifyForVault) {
        await consumeIdentityVerificationSession({
          id: verificationSession.id,
          requestId: input.requestId,
          verificationId,
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
