import crypto from "node:crypto";

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
  getLatestSignedClaimByUserTypeAndDocument,
  getProofHashesByUserAndDocument,
  getUserAgeProof,
  getUserAgeProofFull,
  insertZkProofRecord,
} from "@/lib/db/queries/crypto";
import {
  getSelectedIdentityDocumentByUserId,
  getVerificationStatus,
  updateIdentityBundleStatus,
} from "@/lib/db/queries/identity";
import { FACE_MATCH_MIN_CONFIDENCE } from "@/lib/identity/liveness/policy";
import {
  getTodayDobDays,
  minAgeYearsToDays,
} from "@/lib/identity/verification/birth-year";
import { withSpan } from "@/lib/observability/telemetry";
import { consumeChallenge } from "@/lib/privacy/crypto/challenge-store";
import { scheduleFheEncryption } from "@/lib/privacy/crypto/fhe-encryption";
import { verifyAttestationClaim } from "@/lib/privacy/crypto/signed-claims";
import { getTodayAsInt } from "@/lib/privacy/zk/noir-prover";
import {
  getBbJsVersion,
  getCircuitMetadata,
  verifyNoirProof,
} from "@/lib/privacy/zk/noir-verifier";
import {
  CIRCUIT_SPECS,
  normalizeChallengeNonce,
  parsePublicInputToNumber,
} from "@/lib/privacy/zk/zk-circuit-spec";

import { protectedProcedure } from "../../server";
import { invalidateVerificationCache } from "../identity/helpers/verification-cache";
import { circuitTypeSchema } from "./challenge";
import {
  assertPolicyVersion,
  computeProofHash,
  computeProofSetHash,
  type FaceMatchClaimData,
  getVerifiedClaim,
  type OcrClaimData,
  parseFieldToBigInt,
} from "./verification-utils";

const MIN_FACE_MATCH_THRESHOLD = Math.round(FACE_MATCH_MIN_CONFIDENCE * 10_000);
const MIN_FACE_MATCH_PERCENT = Math.round(FACE_MATCH_MIN_CONFIDENCE * 100);

type NoirVerificationResult = Awaited<ReturnType<typeof verifyNoirProof>>;
type ProofVerificationResult = NoirVerificationResult & { reason?: string };

async function verifyProofInternal(args: {
  userId: string;
  circuitType: z.infer<typeof circuitTypeSchema>;
  proof: string;
  publicInputs: string[];
  documentId: string | null;
}): Promise<{ result: ProofVerificationResult; nonceHex: string }> {
  const circuitType = args.circuitType;
  const circuitSpec = CIRCUIT_SPECS[circuitType];
  const circuitMeta = getCircuitMetadata(circuitType);
  const bbVersion = getBbJsVersion();

  if (args.publicInputs.length < circuitSpec.minPublicInputs) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `${circuitType} requires ${circuitSpec.minPublicInputs} public inputs`,
    });
  }

  const nonceHex = normalizeChallengeNonce(
    args.publicInputs[circuitSpec.nonceIndex]
  );

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
  const claimHashInput = args.publicInputs[circuitSpec.claimHashIndex];
  if (!claimHashInput) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Missing claim hash in public inputs",
    });
  }
  const claimHashBigInt = parseFieldToBigInt(claimHashInput);

  if (circuitType === "age_verification") {
    const providedCurrentDays = parsePublicInputToNumber(args.publicInputs[0]);
    const providedMinAgeDays = parsePublicInputToNumber(args.publicInputs[1]);
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

    const ocrClaim = await getVerifiedClaim(
      args.userId,
      "ocr_result",
      args.documentId
    );
    assertPolicyVersion(ocrClaim, "ocr_result");
    const claimData = ocrClaim.data as OcrClaimData;
    const expectedHash = claimData.claimHashes?.age;
    if (!expectedHash) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Missing age claim hash in OCR claim",
      });
    }
    if (parseFieldToBigInt(expectedHash) !== claimHashBigInt) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Age claim hash mismatch",
      });
    }
  }

  if (circuitType === "doc_validity") {
    const providedDate = parsePublicInputToNumber(args.publicInputs[0]);
    const actualDate = getTodayAsInt();
    if (providedDate !== actualDate) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Invalid current_date: ${providedDate} (expected ${actualDate})`,
      });
    }

    const ocrClaim = await getVerifiedClaim(
      args.userId,
      "ocr_result",
      args.documentId
    );
    assertPolicyVersion(ocrClaim, "ocr_result");
    const claimData = ocrClaim.data as OcrClaimData;
    const expectedHash = claimData.claimHashes?.docValidity;
    if (!expectedHash) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Missing document validity claim hash in OCR claim",
      });
    }
    if (parseFieldToBigInt(expectedHash) !== claimHashBigInt) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Document validity claim hash mismatch",
      });
    }
  }

  if (circuitType === "nationality_membership") {
    const ocrClaim = await getVerifiedClaim(
      args.userId,
      "ocr_result",
      args.documentId
    );
    assertPolicyVersion(ocrClaim, "ocr_result");
    const claimData = ocrClaim.data as OcrClaimData;
    const expectedHash = claimData.claimHashes?.nationality;
    if (!expectedHash) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Missing nationality claim hash in OCR claim",
      });
    }
    if (parseFieldToBigInt(expectedHash) !== claimHashBigInt) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Nationality claim hash mismatch",
      });
    }
  }

  if (circuitType === "face_match") {
    const providedThreshold = parsePublicInputToNumber(args.publicInputs[0]);

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
      args.documentId
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

  if (circuitType === "age_verification") {
    const isOldEnough = parsePublicInputToNumber(
      args.publicInputs[circuitSpec.resultIndex]
    );
    if (isOldEnough !== 1) {
      return failure(
        "Age requirement not met",
        verificationResult.verificationTimeMs
      );
    }
  }

  if (circuitType === "doc_validity") {
    const isDocValid = parsePublicInputToNumber(
      args.publicInputs[circuitSpec.resultIndex]
    );
    if (isDocValid !== 1) {
      return failure("Document expired", verificationResult.verificationTimeMs);
    }
  }

  if (circuitType === "nationality_membership") {
    const isMember = parsePublicInputToNumber(
      args.publicInputs[circuitSpec.resultIndex]
    );
    if (isMember !== 1) {
      return failure(
        "Nationality not in group",
        verificationResult.verificationTimeMs
      );
    }
  }

  if (circuitType === "face_match") {
    const isMatch = parsePublicInputToNumber(
      args.publicInputs[circuitSpec.resultIndex]
    );
    if (isMatch !== 1) {
      return failure(
        "Face match threshold not met",
        verificationResult.verificationTimeMs
      );
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
      documentId: z.string().optional(),
    })
  )
  .mutation(async ({ ctx, input }) => {
    const selectedDocument = await getSelectedIdentityDocumentByUserId(
      ctx.userId
    );
    const documentId = input.documentId ?? selectedDocument?.id ?? null;
    const { result, nonceHex } = await verifyProofInternal({
      userId: ctx.userId,
      circuitType: input.circuitType,
      proof: input.proof,
      publicInputs: input.publicInputs,
      documentId,
    });

    if (!result.isValid) {
      return result;
    }

    const challenge = await consumeChallenge(
      nonceHex,
      input.circuitType,
      ctx.userId
    );
    if (!challenge) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Invalid or expired challenge nonce",
      });
    }

    return result;
  });

export const getUserProofProcedure = protectedProcedure
  .input(z.object({ full: z.boolean().optional() }).optional())
  .query(async ({ ctx, input }) =>
    input?.full === true
      ? await getUserAgeProofFull(ctx.userId)
      : await getUserAgeProof(ctx.userId)
  );

/**
 * Fetch latest signed claims for proof generation (OCR + face match + liveness).
 */
export const getSignedClaimsProcedure = protectedProcedure
  .input(z.object({ documentId: z.string().optional() }).optional())
  .query(async ({ ctx, input }) => {
    const selectedDocument = await getSelectedIdentityDocumentByUserId(
      ctx.userId
    );
    const documentId = input?.documentId ?? selectedDocument?.id ?? null;
    if (!documentId) {
      return {
        documentId: null,
        ocr: null,
        faceMatch: null,
        liveness: null,
      };
    }

    const ocr = await getLatestSignedClaimByUserTypeAndDocument(
      ctx.userId,
      "ocr_result",
      documentId
    );
    const faceMatch = await getLatestSignedClaimByUserTypeAndDocument(
      ctx.userId,
      "face_match_score",
      documentId
    );
    const liveness = await getLatestSignedClaimByUserTypeAndDocument(
      ctx.userId,
      "liveness_score",
      documentId
    );

    return {
      documentId,
      ocr: ocr
        ? await verifyAttestationClaim(ocr.signature, "ocr_result", ctx.userId)
        : null,
      faceMatch: faceMatch
        ? await verifyAttestationClaim(
            faceMatch.signature,
            "face_match_score",
            ctx.userId
          )
        : null,
      liveness: liveness
        ? await verifyAttestationClaim(
            liveness.signature,
            "liveness_score",
            ctx.userId
          )
        : null,
    };
  });

/**
 * Stores a verified ZK proof for the authenticated user.
 *
 * Validates:
 * - Public signals format matches circuit spec
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
      generationTimeMs: z.number().optional(),
      documentId: z.string().optional(),
    })
  )
  .mutation(async ({ ctx, input }) => {
    const selectedDocument = await getSelectedIdentityDocumentByUserId(
      ctx.userId
    );
    const documentId = input.documentId ?? selectedDocument?.id ?? null;
    if (!documentId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Missing document context for proof storage",
      });
    }

    const { result, nonceHex } = await verifyProofInternal({
      userId: ctx.userId,
      circuitType: input.circuitType,
      proof: input.proof,
      publicInputs: input.publicSignals,
      documentId,
    });

    if (!result.isValid) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: result.reason || "Proof verification failed",
      });
    }

    const challenge = await consumeChallenge(
      nonceHex,
      input.circuitType,
      ctx.userId
    );
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
      "db.insert_zk_proof",
      { "zk.circuit_type": input.circuitType },
      () =>
        insertZkProofRecord({
          id: proofId,
          userId: ctx.userId,
          documentId,
          proofType: input.circuitType,
          proofHash,
          proofPayload: input.proof,
          publicInputs: JSON.stringify(input.publicSignals),
          isOver18: input.circuitType === "age_verification" ? true : null,
          generationTimeMs: input.generationTimeMs,
          nonce: nonceHex,
          policyVersion: POLICY_VERSION,
          circuitType: result.circuitType,
          noirVersion: result.noirVersion,
          circuitHash: result.circuitHash,
          verificationKeyHash: result.verificationKeyHash,
          verificationKeyPoseidonHash: result.verificationKeyPoseidonHash,
          bbVersion: result.bbVersion,
          verified: true,
        })
    );

    const proofHashes = await getProofHashesByUserAndDocument(
      ctx.userId,
      documentId
    );
    const proofSetHash = computeProofSetHash({
      proofHashes,
      policyHash: POLICY_HASH,
    });
    await withSpan("db.upsert_attestation_evidence", {}, () =>
      upsertAttestationEvidence({
        userId: ctx.userId,
        documentId,
        policyVersion: POLICY_VERSION,
        policyHash: POLICY_HASH,
        proofSetHash,
      })
    );

    const verificationStatus = await getVerificationStatus(ctx.userId);
    if (verificationStatus.verified) {
      await updateIdentityBundleStatus({
        userId: ctx.userId,
        status: "verified",
        policyVersion: POLICY_VERSION,
        issuerId: ISSUER_ID,
      });
    }

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
