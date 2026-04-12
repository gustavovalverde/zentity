import { TRPCError } from "@trpc/server";
import z from "zod";

import {
  ISSUER_ID,
  MIN_AGE_POLICY,
  POLICY_VERSION,
} from "@/lib/blockchain/attestation/policy";
import { POLICY_HASH } from "@/lib/blockchain/attestation/policy-hash";
import { upsertAttestationEvidence } from "@/lib/db/queries/attestation";
import {
  closeProofSession,
  getLatestSignedClaimByUserTypeAndVerification,
  getProofHashesByUserVerificationAndSession,
  getProofSessionById,
  getProofTypesByUserVerificationAndSession,
  getUserBaseCommitments,
  insertProofArtifact,
} from "@/lib/db/queries/crypto";
import {
  getSelectedVerification,
  getVerificationStatus,
  updateIdentityBundleStatus,
} from "@/lib/db/queries/identity";
import { FACE_MATCH_MIN_CONFIDENCE } from "@/lib/identity/liveness/thresholds";
import {
  getTodayDobDays,
  minAgeYearsToDays,
} from "@/lib/identity/verification/birth-year";
import { materializeVerificationChecks } from "@/lib/identity/verification/materialize";
import { getUnifiedVerificationModel } from "@/lib/identity/verification/unified-model";
import { withSpan } from "@/lib/observability/telemetry";
import { scheduleFheEncryption } from "@/lib/privacy/fhe/encryption";
import { verifyAttestationClaim } from "@/lib/privacy/zk/attestation-claims";
import { consumeChallenge } from "@/lib/privacy/zk/challenge-store";
import {
  HASH_TO_FIELD_INFO,
  hashToFieldHexFromString,
} from "@/lib/privacy/zk/hash-to-field";
import { getTodayAsInt } from "@/lib/privacy/zk/noir-prover";
import {
  getBbJsVersion,
  getCircuitMetadata,
  verifyNoirProof,
} from "@/lib/privacy/zk/noir-verifier";
import {
  normalizeChallengeNonce,
  PROOF_TYPE_SPECS,
} from "@/lib/privacy/zk/proof-types";
import {
  assertPolicyVersion,
  computeProofHash,
  computeProofSetHash,
  type FaceMatchClaimData,
  getVerifiedClaim,
  type OcrClaimData,
  parseFieldToBigInt,
} from "@/lib/privacy/zk/verification-utils";
import { resolveAudience } from "@/lib/utils/http";

import { protectedProcedure } from "../server";
import { invalidateVerificationCache } from "./identity-job-processor";

export const circuitTypeSchema = z.enum([
  "age_verification",
  "doc_validity",
  "nationality_membership",
  "face_match",
  "identity_binding",
]);

const MIN_FACE_MATCH_THRESHOLD = Math.round(FACE_MATCH_MIN_CONFIDENCE * 10_000);
const MIN_FACE_MATCH_PERCENT = Math.round(FACE_MATCH_MIN_CONFIDENCE * 100);
const U32_MAX = BigInt(0xff_ff_ff_ff);
const REQUIRED_SESSION_PROOFS = [
  "age_verification",
  "doc_validity",
  "nationality_membership",
  "face_match",
  "identity_binding",
] as const;

type NoirVerificationResult = Awaited<ReturnType<typeof verifyNoirProof>>;
type ProofVerificationResult = NoirVerificationResult & { reason?: string };

async function requireActiveProofSession(args: {
  audience: string;
  verificationId?: string | null | undefined;
  proofSessionId: string;
  userId: string;
}) {
  const proofSession = await getProofSessionById(args.proofSessionId);
  if (!proofSession) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Unknown proof session",
    });
  }
  if (
    proofSession.userId !== args.userId ||
    proofSession.msgSender !== args.userId ||
    proofSession.audience !== args.audience
  ) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Proof session context mismatch",
    });
  }
  if (
    args.verificationId !== undefined &&
    args.verificationId !== null &&
    proofSession.verificationId !== args.verificationId
  ) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Proof session does not match user/verification context",
    });
  }
  if (proofSession.policyVersion !== POLICY_VERSION) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Proof session policy version mismatch",
    });
  }
  if (proofSession.expiresAt < Date.now()) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Proof session expired",
    });
  }
  if (proofSession.closedAt !== null) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Proof session already closed",
    });
  }

  return proofSession;
}

async function hashContextToField(
  value: string,
  info:
    | typeof HASH_TO_FIELD_INFO.IDENTITY_MSG_SENDER
    | typeof HASH_TO_FIELD_INFO.IDENTITY_AUDIENCE
): Promise<bigint> {
  return BigInt(await hashToFieldHexFromString(value, info));
}

function parseU32PublicInput(value: string, fieldName: string): number {
  const parsed = parseFieldToBigInt(value);
  if (parsed < BigInt(0) || parsed > U32_MAX) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Invalid ${fieldName}: must fit in uint32`,
    });
  }
  return Number(parsed);
}

async function assertOcrClaimHash(
  userId: string,
  verificationId: string | null,
  hashKey: keyof NonNullable<OcrClaimData["claimHashes"]>,
  claimHashBigInt: bigint,
  label: string
): Promise<void> {
  const ocrClaim = await getVerifiedClaim(userId, "ocr_result", verificationId);
  assertPolicyVersion(ocrClaim, "ocr_result");
  const claimData = ocrClaim.data as OcrClaimData;
  const expectedHash = claimData.claimHashes?.[hashKey];
  if (!expectedHash) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Missing ${label} claim hash in OCR claim`,
    });
  }
  if (parseFieldToBigInt(expectedHash) !== claimHashBigInt) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `${label} claim hash mismatch`,
    });
  }
}

function assertResultBit(
  publicInputs: string[],
  resultIndex: number,
  failureReason: string,
  failure: (
    reason: string,
    ms?: number
  ) => {
    result: ProofVerificationResult;
    nonceHex: string;
  },
  verificationTimeMs: number
): { result: ProofVerificationResult; nonceHex: string } | null {
  const resultInput = publicInputs[resultIndex];
  if (resultInput === undefined) {
    return failure(
      `Missing public input at index ${resultIndex}`,
      verificationTimeMs
    );
  }
  const bit = Number(BigInt(resultInput));
  if (bit !== 1) {
    return failure(failureReason, verificationTimeMs);
  }
  return null;
}

async function verifyProofInternal(args: {
  userId: string;
  circuitType: z.infer<typeof circuitTypeSchema>;
  proof: string;
  publicInputs: string[];
  verificationId: string | null;
  msgSender: string;
  audience: string;
}): Promise<{ result: ProofVerificationResult; nonceHex: string }> {
  const circuitType = args.circuitType;
  const circuitSpec = PROOF_TYPE_SPECS[circuitType];
  const circuitMeta = getCircuitMetadata(circuitType);
  const bbVersion = getBbJsVersion();

  if (args.publicInputs.length < circuitSpec.minPublicInputs) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `${circuitType} requires ${circuitSpec.minPublicInputs} public inputs`,
    });
  }

  const nonceInput = args.publicInputs[circuitSpec.nonceIndex];
  if (nonceInput === undefined) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Missing nonce in public inputs",
    });
  }
  const nonceHex = normalizeChallengeNonce(nonceInput);

  const failure = (reason: string, verificationTimeMs = 0) => ({
    result: {
      isValid: false,
      reason,
      verificationTimeMs,
      circuitType,
      noirVersion: circuitMeta.noirVersion,
      circuitHash: circuitMeta.circuitHash,
      circuitId: null,
      verificationKeyHash: null,
      verificationKeyPoseidonHash: null,
      bbVersion,
    },
    nonceHex,
  });
  // Identity binding uses binding_commitment instead of claim hash
  // Skip claim hash validation for this circuit type
  const requiresClaimHash = circuitType !== "identity_binding";
  const claimHashInput = args.publicInputs[circuitSpec.claimHashIndex];

  if (requiresClaimHash && !claimHashInput) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Missing claim hash in public inputs",
    });
  }
  const claimHashBigInt =
    requiresClaimHash && claimHashInput
      ? parseFieldToBigInt(claimHashInput)
      : BigInt(0);

  // Identity binding validation: binding_commitment only (auth_mode removed for privacy)
  if (circuitType === "identity_binding") {
    const bindingCommitmentInput =
      args.publicInputs[circuitSpec.claimHashIndex];
    if (bindingCommitmentInput === undefined) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Missing binding commitment in public inputs",
      });
    }
    const bindingCommitment = parseFieldToBigInt(bindingCommitmentInput);

    if (bindingCommitment === BigInt(0)) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Invalid binding commitment (zero)",
      });
    }

    const msgSenderIndex = circuitSpec.msgSenderIndex;
    const audienceIndex = circuitSpec.audienceIndex;
    if (
      msgSenderIndex === undefined ||
      audienceIndex === undefined ||
      args.publicInputs[msgSenderIndex] === undefined ||
      args.publicInputs[audienceIndex] === undefined
    ) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Missing identity binding context inputs",
      });
    }

    const baseCommitmentIndex =
      circuitSpec.publicInputOrder.indexOf("base_commitment");
    const baseCommitmentInput = args.publicInputs[baseCommitmentIndex];
    if (baseCommitmentInput === undefined) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Missing base commitment in public inputs",
      });
    }
    const providedBaseCommitment = parseFieldToBigInt(baseCommitmentInput);

    if (providedBaseCommitment === BigInt(0)) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Invalid base commitment (zero)",
      });
    }

    const providedMsgSenderHash = parseFieldToBigInt(
      args.publicInputs[msgSenderIndex]
    );
    const providedAudienceHash = parseFieldToBigInt(
      args.publicInputs[audienceIndex]
    );

    const [expectedMsgSenderHash, expectedAudienceHash, storedCommitmentHexes] =
      await Promise.all([
        hashContextToField(
          args.msgSender,
          HASH_TO_FIELD_INFO.IDENTITY_MSG_SENDER
        ),
        hashContextToField(args.audience, HASH_TO_FIELD_INFO.IDENTITY_AUDIENCE),
        getUserBaseCommitments(args.userId),
      ]);

    if (providedMsgSenderHash !== expectedMsgSenderHash) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Identity binding msg_sender mismatch",
      });
    }
    if (providedAudienceHash !== expectedAudienceHash) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Identity binding audience mismatch",
      });
    }

    const storedCommitments = storedCommitmentHexes.map((hex) => BigInt(hex));

    if (storedCommitments.length === 0) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "No registered credentials found for identity binding",
      });
    }

    if (!storedCommitments.includes(providedBaseCommitment)) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          "Identity binding failed: Base commitment does not match any registered credential.",
      });
    }
  }

  if (circuitType === "age_verification") {
    const ageInput0 = args.publicInputs[0];
    const ageInput1 = args.publicInputs[1];
    if (ageInput0 === undefined || ageInput1 === undefined) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Missing age verification public inputs",
      });
    }
    const providedCurrentDays = parseU32PublicInput(ageInput0, "current_days");
    const providedMinAgeDays = parseU32PublicInput(ageInput1, "min_age_days");
    const actualCurrentDays = getTodayDobDays();

    // Allow minor drift to avoid timezone edge cases.
    if (Math.abs(providedCurrentDays - actualCurrentDays) > 2) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Invalid current_days: ${providedCurrentDays} (expected ~${actualCurrentDays})`,
      });
    }

    const minAgePolicyDays = minAgeYearsToDays(MIN_AGE_POLICY);
    if (providedMinAgeDays < minAgePolicyDays) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `min_age_days ${providedMinAgeDays} below policy minimum ${minAgePolicyDays}`,
      });
    }

    await assertOcrClaimHash(
      args.userId,
      args.verificationId,
      "age",
      claimHashBigInt,
      "age"
    );
  }

  if (circuitType === "doc_validity") {
    const docInput0 = args.publicInputs[0];
    if (docInput0 === undefined) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Missing doc validity public input",
      });
    }
    const providedDate = Number(BigInt(docInput0));
    const actualDate = getTodayAsInt();
    if (providedDate !== actualDate) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Invalid current_date: ${providedDate} (expected ${actualDate})`,
      });
    }

    await assertOcrClaimHash(
      args.userId,
      args.verificationId,
      "docValidity",
      claimHashBigInt,
      "document validity"
    );
  }

  if (circuitType === "nationality_membership") {
    await assertOcrClaimHash(
      args.userId,
      args.verificationId,
      "nationality",
      claimHashBigInt,
      "nationality"
    );
  }

  if (circuitType === "face_match") {
    const faceInput0 = args.publicInputs[0];
    if (faceInput0 === undefined) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Missing face match public input",
      });
    }
    const providedThreshold = Number(BigInt(faceInput0));

    if (providedThreshold < MIN_FACE_MATCH_THRESHOLD) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `threshold ${providedThreshold} below policy minimum ${MIN_FACE_MATCH_THRESHOLD} (${MIN_FACE_MATCH_PERCENT}.00%)`,
      });
    }

    if (providedThreshold > 10_000) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `threshold ${providedThreshold} exceeds maximum 10000 (100.00%)`,
      });
    }

    const faceClaim = await getVerifiedClaim(
      args.userId,
      "face_match_score",
      args.verificationId
    );
    assertPolicyVersion(faceClaim, "face_match_score");
    const claimData = faceClaim.data as FaceMatchClaimData;
    if (!claimData.claimHash) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Missing face match claim hash",
      });
    }
    if (parseFieldToBigInt(claimData.claimHash) !== claimHashBigInt) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Face match claim hash mismatch",
      });
    }

    let confidenceFixed: number | null;
    if (typeof claimData.confidenceFixed === "number") {
      confidenceFixed = claimData.confidenceFixed;
    } else if (typeof claimData.confidence === "number") {
      confidenceFixed = Math.round(claimData.confidence * 10_000);
    } else {
      confidenceFixed = null;
    }
    if (confidenceFixed === null || Number.isNaN(confidenceFixed)) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Invalid face match claim payload",
      });
    }

    if (confidenceFixed < providedThreshold) {
      return failure("Face match threshold not met (signed claim)");
    }
  }

  const verificationResult = await withSpan(
    "zk.verify_noir_proof",
    {
      "zk.circuit_type": circuitType,
      "zk.public_inputs_count": args.publicInputs.length,
    },
    () =>
      verifyNoirProof({
        proof: args.proof,
        publicInputs: args.publicInputs,
        circuitType,
      })
  );

  if (!verificationResult.isValid) {
    return { result: verificationResult, nonceHex };
  }

  const resultFailureReasons: Partial<
    Record<z.infer<typeof circuitTypeSchema>, string>
  > = {
    age_verification: "Age requirement not met",
    doc_validity: "Document expired",
    nationality_membership: "Nationality not in group",
    face_match: "Face match threshold not met",
    identity_binding: "Identity binding failed",
  };

  const reason = resultFailureReasons[circuitType];
  if (reason) {
    const resultFailure = assertResultBit(
      args.publicInputs,
      circuitSpec.resultIndex,
      reason,
      failure,
      verificationResult.verificationTimeMs
    );
    if (resultFailure) {
      return resultFailure;
    }
  }

  return { result: verificationResult, nonceHex };
}

/**
 * Verifies a Noir ZK proof using UltraHonk (Barretenberg).
 *
 * Performs:
 * 1. Nonce validation (replay prevention)
 * 2. Policy enforcement (min age, current date, thresholds)
 * 3. Cryptographic proof verification
 * 4. Circuit output validation (is_old_enough, is_valid, etc.)
 */
export const verifyProofProcedure = protectedProcedure
  .input(
    z.object({
      proof: z.string().min(1),
      publicInputs: z.array(z.string()),
      circuitType: circuitTypeSchema,
      proofSessionId: z.string().uuid(),
      verificationId: z.string().optional(),
    })
  )
  .mutation(async ({ ctx, input }) => {
    const currentAudience = resolveAudience(ctx.req);
    const proofSession = await requireActiveProofSession({
      proofSessionId: input.proofSessionId,
      userId: ctx.userId,
      audience: currentAudience,
      verificationId: input.verificationId,
    });
    const verificationId = input.verificationId ?? proofSession.verificationId;
    const { result, nonceHex } = await verifyProofInternal({
      userId: ctx.userId,
      circuitType: input.circuitType,
      proof: input.proof,
      publicInputs: input.publicInputs,
      verificationId,
      msgSender: ctx.userId,
      audience: currentAudience,
    });

    if (!result.isValid) {
      return result;
    }

    const challenge = await consumeChallenge(nonceHex, input.circuitType, {
      userId: ctx.userId,
      msgSender: ctx.userId,
      audience: currentAudience,
      proofSessionId: input.proofSessionId,
    });
    if (!challenge) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Invalid or expired challenge nonce",
      });
    }

    return result;
  });

/**
 * Get materialized verification checks with evidence sources.
 * Returns 7 boolean checks (document, age, liveness, face_match, nationality,
 * identity_binding, sybil_resistant) with source attribution.
 * Works for both OCR and NFC chip verification paths.
 */
export const getChecksProcedure = protectedProcedure.query(async ({ ctx }) => {
  const model = await getUnifiedVerificationModel(ctx.userId);
  return {
    method: model.method,
    level: model.compliance.level,
    verified: model.compliance.verified,
    checks: model.checks,
  };
});

/**
 * Get verified proof summaries for the authenticated user.
 * Returns proof system, type, hash, and creation time for all verified proofs.
 * Covers both Noir/UltraHonk (OCR) and ZKPassport (NFC chip) proofs.
 */
export const getProofsProcedure = protectedProcedure.query(async ({ ctx }) => {
  const model = await getUnifiedVerificationModel(ctx.userId);
  return {
    method: model.method,
    proofs: model.proofs,
  };
});

/**
 * Fetch latest signed claims for proof generation (OCR + face match + liveness).
 */
export const getSignedClaimsProcedure = protectedProcedure
  .input(z.object({ verificationId: z.string().optional() }).optional())
  .query(async ({ ctx, input }) => {
    const selectedVerification = await getSelectedVerification(ctx.userId);
    const verificationId =
      input?.verificationId ?? selectedVerification?.id ?? null;
    if (!verificationId) {
      return {
        verificationId: null,
        ocr: null,
        faceMatch: null,
        liveness: null,
      };
    }

    // Parallelize independent DB queries
    const [ocr, faceMatch, liveness] = await Promise.all([
      getLatestSignedClaimByUserTypeAndVerification(
        ctx.userId,
        "ocr_result",
        verificationId
      ),
      getLatestSignedClaimByUserTypeAndVerification(
        ctx.userId,
        "face_match_score",
        verificationId
      ),
      getLatestSignedClaimByUserTypeAndVerification(
        ctx.userId,
        "liveness_score",
        verificationId
      ),
    ]);

    // Parallelize independent verification calls
    const [verifiedOcr, verifiedFaceMatch, verifiedLiveness] =
      await Promise.all([
        ocr
          ? verifyAttestationClaim(ocr.signature, "ocr_result", ctx.userId)
          : null,
        faceMatch
          ? verifyAttestationClaim(
              faceMatch.signature,
              "face_match_score",
              ctx.userId
            )
          : null,
        liveness
          ? verifyAttestationClaim(
              liveness.signature,
              "liveness_score",
              ctx.userId
            )
          : null,
      ]);

    return {
      verificationId,
      ocr: verifiedOcr,
      faceMatch: verifiedFaceMatch,
      liveness: verifiedLiveness,
    };
  });

/**
 * Stores a verified ZK proof for the authenticated user.
 *
 * Validates:
 * - Public signals format matches circuit spec
 * - Identity binding exists before storing non-binding proofs
 * - Policy enforcement (age/current date/thresholds)
 * - Signed claim binding via claim_hash
 * - Cryptographic proof validity
 * - Challenge nonce is valid and unconsumed
 */
export const storeProofProcedure = protectedProcedure
  .input(
    z.object({
      circuitType: circuitTypeSchema,
      proof: z.string().min(1),
      publicSignals: z.array(z.string()),
      proofSessionId: z.string().uuid(),
      generationTimeMs: z.number().optional(),
      verificationId: z.string().optional(),
    })
  )
  .mutation(async ({ ctx, input }) => {
    const selectedVerification = await getSelectedVerification(ctx.userId);
    const verificationId =
      input.verificationId ?? selectedVerification?.id ?? null;
    if (!verificationId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Missing verification context for proof storage",
      });
    }

    const currentAudience = resolveAudience(ctx.req);
    await requireActiveProofSession({
      proofSessionId: input.proofSessionId,
      userId: ctx.userId,
      audience: currentAudience,
      verificationId,
    });

    if (input.circuitType !== "identity_binding") {
      const sessionProofTypes = await getProofTypesByUserVerificationAndSession(
        ctx.userId,
        verificationId,
        input.proofSessionId
      );
      if (!sessionProofTypes.includes("identity_binding")) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Identity binding proof is required before storing other proofs",
        });
      }
    }

    const { result, nonceHex } = await verifyProofInternal({
      userId: ctx.userId,
      circuitType: input.circuitType,
      proof: input.proof,
      publicInputs: input.publicSignals,
      verificationId,
      msgSender: ctx.userId,
      audience: resolveAudience(ctx.req),
    });

    if (!result.isValid) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: result.reason || "Proof verification failed",
      });
    }

    const challenge = await consumeChallenge(nonceHex, input.circuitType, {
      userId: ctx.userId,
      msgSender: ctx.userId,
      audience: currentAudience,
      proofSessionId: input.proofSessionId,
    });
    if (!challenge) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Invalid or expired challenge nonce",
      });
    }

    const proofId = crypto.randomUUID();
    const proofHash = computeProofHash({
      proof: input.proof,
      publicInputs: input.publicSignals,
      policyVersion: POLICY_VERSION,
    });

    await withSpan(
      "db.insert_proof_artifact",
      { "proof.circuit_type": input.circuitType },
      () =>
        insertProofArtifact({
          id: proofId,
          userId: ctx.userId,
          verificationId,
          proofSessionId: input.proofSessionId,
          proofSystem: "noir_ultrahonk",
          proofType: input.circuitType,
          proofHash,
          proofPayload: input.proof,
          publicInputs: JSON.stringify(input.publicSignals),
          generationTimeMs: input.generationTimeMs,
          nonce: nonceHex,
          policyVersion: POLICY_VERSION,
          metadata: JSON.stringify({
            circuitType: result.circuitType,
            noirVersion: result.noirVersion,
            circuitHash: result.circuitHash,
            verificationKeyHash: result.verificationKeyHash,
            verificationKeyPoseidonHash: result.verificationKeyPoseidonHash,
            bbVersion: result.bbVersion,
            ...(input.circuitType === "age_verification"
              ? { isOver18: true }
              : {}),
          }),
          verified: true,
        })
    );

    const proofHashes = await getProofHashesByUserVerificationAndSession(
      ctx.userId,
      verificationId,
      input.proofSessionId
    );
    const proofSetHash = computeProofSetHash({
      proofHashes,
      policyHash: POLICY_HASH,
    });
    await withSpan("db.upsert_attestation_evidence", {}, () =>
      upsertAttestationEvidence({
        userId: ctx.userId,
        verificationId,
        policyVersion: POLICY_VERSION,
        policyHash: POLICY_HASH,
        proofSetHash,
      })
    );

    const sessionProofTypes = await getProofTypesByUserVerificationAndSession(
      ctx.userId,
      verificationId,
      input.proofSessionId
    );
    const sessionComplete = REQUIRED_SESSION_PROOFS.every((proofType) =>
      sessionProofTypes.includes(proofType)
    );
    if (sessionComplete) {
      await closeProofSession(input.proofSessionId);
    }

    const verificationStatus = await getVerificationStatus(ctx.userId);
    if (verificationStatus.verified) {
      await updateIdentityBundleStatus({
        userId: ctx.userId,
        status: "verified",
        policyVersion: POLICY_VERSION,
        issuerId: ISSUER_ID,
      });
    }

    await materializeVerificationChecks(ctx.userId, verificationId);

    invalidateVerificationCache(ctx.userId);
    scheduleFheEncryption({
      userId: ctx.userId,
      requestId: ctx.requestId,
      flowId: ctx.flowId ?? undefined,
      reason: "proof_stored",
    });

    return {
      success: true,
      proofId,
      proofHash,
      verificationTimeMs: result.verificationTimeMs,
      circuitType: result.circuitType,
      noirVersion: result.noirVersion,
      circuitHash: result.circuitHash,
      verificationKeyHash: result.verificationKeyHash,
      verificationKeyPoseidonHash: result.verificationKeyPoseidonHash,
      bbVersion: result.bbVersion,
    };
  });
