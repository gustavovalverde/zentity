/**
 * ZK Router
 *
 * Handles ZK proof verification, storage, BBS+ credentials, and challenge-response
 * anti-replay protection.
 *
 * Key operations:
 * - verifyProof: Verify Noir ZK proofs with policy enforcement
 * - createChallenge: Issue nonces for replay-resistant proof generation
 * - storeProof: Persist verified ZK proofs for authenticated users
 * - bbs.*: BBS+ credential issuance, presentation creation, and verification
 *
 * Policy enforcement:
 * - MIN_AGE_POLICY: Age proofs must verify age >= 18
 * - MIN_FACE_MATCH_THRESHOLD: Face similarity must be >= FACE_MATCH_MIN_CONFIDENCE
 * - Nonce validation prevents proof replay attacks
 */
import "server-only";

import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { env } from "@/env";
import {
  ISSUER_ID,
  MIN_AGE_POLICY,
  POLICY_VERSION,
} from "@/lib/blockchain/attestation/policy";
import { POLICY_HASH } from "@/lib/blockchain/attestation/policy-hash";
import { upsertAttestationEvidence } from "@/lib/db/queries/attestation";
import {
  getAccountIdentity,
  getComplianceStatus,
  reconcileIdentityBundle,
  updateIdentityBundleAttestationState,
} from "@/lib/db/queries/identity";
import {
  closeProofSession,
  createProofSession,
  getLatestSignedClaimByUserTypeAndVerification,
  getProofHashesByUserVerificationAndSession,
  getProofSessionById,
  getProofTypesByUserVerificationAndSession,
  getUserBaseCommitments,
  insertProofArtifact,
} from "@/lib/db/queries/privacy";
import { resolveAudience } from "@/lib/http/url-safety";
import { FACE_MATCH_MIN_CONFIDENCE } from "@/lib/identity/liveness/thresholds";
import {
  getTodayDobDays,
  minAgeYearsToDays,
} from "@/lib/identity/verification/birth-year";
import { invalidateVerificationCache } from "@/lib/identity/verification/job-processor";
import { materializeVerificationChecks } from "@/lib/identity/verification/materialize";
import { getVerificationReadModel } from "@/lib/identity/verification/read-model";
import { withSpan } from "@/lib/observability/telemetry";
import { createPresentation } from "@/lib/privacy/bbs/holder";
import { deriveBbsKeyPair } from "@/lib/privacy/bbs/keygen";
import {
  deserializeCredential,
  deserializePresentation,
  type SerializedBbsCredential,
  type SerializedBbsPresentation,
  serializeCredential,
  serializePresentation,
} from "@/lib/privacy/bbs/serialization";
import {
  createWalletCredential,
  verifyCredential,
} from "@/lib/privacy/bbs/signer";
import { WALLET_CREDENTIAL_CLAIM_ORDER } from "@/lib/privacy/bbs/types";
import { verifyPresentation as verifyBbsPresentation } from "@/lib/privacy/bbs/verifier";
import { scheduleFheEncryption } from "@/lib/privacy/fhe/encryption";
import { bytesToBase64 } from "@/lib/privacy/primitives/symmetric";
import { verifyAttestationClaim } from "@/lib/privacy/zk/attestation-claims";
import {
  consumeChallenge,
  createChallenge,
  getActiveChallengeCount,
} from "@/lib/privacy/zk/challenge-store";
import {
  HASH_TO_FIELD_INFO,
  hashToFieldHexFromString,
} from "@/lib/privacy/zk/hash-to-field";
import { getTodayAsInt } from "@/lib/privacy/zk/noir/prover";
import {
  getBbJsVersion,
  getCircuitMetadata,
  prewarmVerificationKeys,
  verifyNoirProof,
} from "@/lib/privacy/zk/noir/verifier";
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
} from "@/lib/privacy/zk/proof-verification";

import { protectedProcedure, publicProcedure, router } from "../server";

const FHE_SERVICE_URL = env.FHE_SERVICE_URL;
const PROOF_SESSION_TTL_MS = 15 * 60 * 1000;

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

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

async function checkServiceUncached(
  url: string,
  timeoutMs = 5000
): Promise<unknown> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${url}/health`, {
      signal: controller.signal,
      headers: {
        "X-Zentity-Healthcheck": "true",
      },
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      return null;
    }
    return await response.json();
  } catch {
    clearTimeout(timeoutId);
    return null;
  }
}

async function checkService(url: string, timeoutMs = 5000): Promise<unknown> {
  const { unstable_cache } = await import("next/cache");
  const cachedCheck = unstable_cache(
    () => checkServiceUncached(url, timeoutMs),
    [`health-check-${url}`],
    { revalidate: 15 }
  );
  return cachedCheck();
}

const healthProcedure = publicProcedure.query(async () => {
  const fheHealth = await checkService(FHE_SERVICE_URL);

  const zk = {
    bbVersion: getBbJsVersion(),
    circuits: {
      age_verification: getCircuitMetadata("age_verification"),
      doc_validity: getCircuitMetadata("doc_validity"),
      nationality_membership: getCircuitMetadata("nationality_membership"),
      face_match: getCircuitMetadata("face_match"),
    },
  };

  const allHealthy =
    (fheHealth as { status?: unknown } | null)?.status === "ok" &&
    Boolean(zk.bbVersion);

  if (allHealthy) {
    prewarmVerificationKeys().catch(() => {
      // Best-effort: warm cache without impacting health response.
    });
  }

  return {
    fhe: fheHealth,
    zk,
    allHealthy,
  };
});

// ---------------------------------------------------------------------------
// Challenge / proof session
// ---------------------------------------------------------------------------

const createProofSessionProcedure = protectedProcedure
  .input(z.object({ verificationId: z.string().optional() }).optional())
  .mutation(async ({ ctx, input }) => {
    const accountIdentity = await getAccountIdentity(ctx.userId);
    const selectedVerification = accountIdentity.effectiveVerification;
    const verificationId =
      input?.verificationId ?? selectedVerification?.id ?? null;
    if (!verificationId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Missing verification context for proof session",
      });
    }

    const now = Date.now();
    const expiresAt = now + PROOF_SESSION_TTL_MS;
    const proofSessionId = crypto.randomUUID();
    const audience = resolveAudience(ctx.req);

    await createProofSession({
      id: proofSessionId,
      userId: ctx.userId,
      verificationId,
      msgSender: ctx.userId,
      audience,
      policyVersion: POLICY_VERSION,
      createdAt: now,
      expiresAt,
    });

    return {
      proofSessionId,
      verificationId,
      expiresAt: new Date(expiresAt).toISOString(),
      policyVersion: POLICY_VERSION,
    };
  });

/**
 * Creates a challenge nonce for replay-resistant proof generation.
 * The nonce must be included in the proof's public inputs and will
 * be consumed on verification (single-use).
 */
const createChallengeProcedure = protectedProcedure
  .input(
    z.object({
      circuitType: circuitTypeSchema,
      proofSessionId: z.uuid(),
    })
  )
  .mutation(async ({ ctx, input }) => {
    const audience = resolveAudience(ctx.req);
    const proofSession = await getProofSessionById(input.proofSessionId);
    if (!proofSession) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Unknown proof session",
      });
    }
    if (
      proofSession.userId !== ctx.userId ||
      proofSession.msgSender !== ctx.userId ||
      proofSession.audience !== audience
    ) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Proof session context mismatch",
      });
    }
    if (proofSession.policyVersion !== POLICY_VERSION) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Proof session policy version mismatch",
      });
    }
    if (proofSession.expiresAt < Date.now() || proofSession.closedAt !== null) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Proof session is not active",
      });
    }

    const challenge = await createChallenge(input.circuitType, {
      userId: ctx.userId,
      msgSender: ctx.userId,
      audience,
      proofSessionId: input.proofSessionId,
    });
    ctx.span?.setAttribute("challenge.circuit_type", input.circuitType);
    ctx.span?.setAttribute(
      "challenge.active_count",
      await getActiveChallengeCount()
    );
    if (challenge.audience) {
      ctx.span?.setAttribute("challenge.audience", challenge.audience);
    }
    return {
      nonce: challenge.nonce,
      circuitType: challenge.circuitType,
      expiresAt: new Date(challenge.expiresAt).toISOString(),
    };
  });

const challengeStatusProcedure = protectedProcedure.query(async () => ({
  activeChallenges: await getActiveChallengeCount(),
  supportedCircuitTypes: circuitTypeSchema.options,
  ttlMinutes: 15,
}));

// ---------------------------------------------------------------------------
// Proof verification (internal helpers)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Proof verification procedures
// ---------------------------------------------------------------------------

/**
 * Verifies a Noir ZK proof using UltraHonk (Barretenberg).
 *
 * Performs:
 * 1. Nonce validation (replay prevention)
 * 2. Policy enforcement (min age, current date, thresholds)
 * 3. Cryptographic proof verification
 * 4. Circuit output validation (is_old_enough, is_valid, etc.)
 */
const verifyProofProcedure = protectedProcedure
  .input(
    z.object({
      proof: z.string().min(1),
      publicInputs: z.array(z.string()),
      circuitType: circuitTypeSchema,
      proofSessionId: z.uuid(),
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
const getChecksProcedure = protectedProcedure.query(async ({ ctx }) => {
  const model = await getVerificationReadModel(ctx.userId);
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
const getProofsProcedure = protectedProcedure.query(async ({ ctx }) => {
  const model = await getVerificationReadModel(ctx.userId);
  return {
    method: model.method,
    proofs: model.proofs,
  };
});

/**
 * Fetch latest signed claims for proof generation (OCR + face match + liveness).
 */
const getSignedClaimsProcedure = protectedProcedure
  .input(z.object({ verificationId: z.string().optional() }).optional())
  .query(async ({ ctx, input }) => {
    const accountIdentity = await getAccountIdentity(ctx.userId);
    const selectedVerification = accountIdentity.effectiveVerification;
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
const storeProofProcedure = protectedProcedure
  .input(
    z.object({
      circuitType: circuitTypeSchema,
      proof: z.string().min(1),
      publicSignals: z.array(z.string()),
      proofSessionId: z.uuid(),
      generationTimeMs: z.number().optional(),
      verificationId: z.string().optional(),
    })
  )
  .mutation(async ({ ctx, input }) => {
    const accountIdentity = await getAccountIdentity(ctx.userId);
    const selectedVerification = accountIdentity.effectiveVerification;
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

    await materializeVerificationChecks(ctx.userId, verificationId);
    await reconcileIdentityBundle(ctx.userId);

    const verificationStatus = await getComplianceStatus(ctx.userId);
    if (verificationStatus.verified) {
      await updateIdentityBundleAttestationState({
        userId: ctx.userId,
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

// ---------------------------------------------------------------------------
// BBS+ wallet credentials (RFC-0020)
// ---------------------------------------------------------------------------

const ISSUER_DID = "did:web:zentity.xyz";
const BBS_KEY_CONTEXT = "zentity-bbs-issuer-v1";

let cachedKeyPairPromise: Promise<
  Awaited<ReturnType<typeof deriveBbsKeyPair>>
> | null = null;

function getIssuerKeyPair() {
  if (cachedKeyPairPromise) {
    return cachedKeyPairPromise;
  }

  const issuerSecret = env.BBS_ISSUER_SECRET;
  if (!issuerSecret) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "BBS issuer not configured",
    });
  }

  const seed = Buffer.from(issuerSecret, "hex");
  if (seed.length < 32) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Invalid BBS issuer secret length",
    });
  }

  cachedKeyPairPromise = deriveBbsKeyPair(seed, BBS_KEY_CONTEXT);
  return cachedKeyPairPromise;
}

const issueWalletCredentialInput = z.object({
  walletCommitment: z.string().startsWith("0x"),
  network: z.string().min(1).max(50),
  chainId: z.number().int().positive().optional(),
  tier: z.number().int().min(1).max(3),
});

const createWalletPresentationInput = z.object({
  credential: z.object({
    format: z.literal("bbs+vc"),
    credentialType: z.literal("wallet").optional(),
    issuer: z.string(),
    holder: z.string(),
    issuedAt: z.string(),
    subject: z.object({
      walletCommitment: z.string(),
      network: z.string(),
      chainId: z.number().optional(),
      verifiedAt: z.string(),
      tier: z.number(),
    }),
    signature: z.object({
      signature: z.string(),
      header: z.string().optional(),
      messageCount: z.number(),
    }),
    issuerPublicKey: z.string(),
  }),
  revealClaims: z.array(
    z.enum(WALLET_CREDENTIAL_CLAIM_ORDER as unknown as [string, ...string[]])
  ),
  verifierNonce: z.string().min(1).max(256),
});

const verifyWalletPresentationInput = z.object({
  presentation: z.object({
    format: z.literal("bbs+vp"),
    credentialType: z.literal("wallet").optional(),
    issuer: z.string(),
    proof: z.object({
      proof: z.string(),
      revealedIndices: z.array(z.number()),
      revealedMessages: z.array(z.string()),
      presentationHeader: z.string().optional(),
    }),
    revealedClaims: z.object({
      walletCommitment: z.string().optional(),
      network: z.string().optional(),
      chainId: z.number().optional(),
      verifiedAt: z.string().optional(),
      tier: z.number().optional(),
    }),
    issuerPublicKey: z.string(),
    header: z.string().optional(),
  }),
});

export const bbsRouter = router({
  /**
   * Issue a BBS+ wallet credential for identity circuit binding (RFC-0020).
   * Called during wallet authentication to bind wallet to verified identity.
   * Requires authentication.
   */
  issueWalletCredential: protectedProcedure
    .input(issueWalletCredentialInput)
    .mutation(async ({ ctx, input }) => {
      const issuerKeyPair = await getIssuerKeyPair();

      const subject = {
        walletCommitment: input.walletCommitment,
        network: input.network,
        chainId: input.chainId,
        verifiedAt: new Date().toISOString(),
        tier: input.tier,
      };

      const holderDid = `did:key:user-${ctx.userId}`;

      const credential = await createWalletCredential(
        subject,
        issuerKeyPair,
        ISSUER_DID,
        holderDid
      );

      return {
        credential: serializeCredential(credential),
      };
    }),

  /**
   * Create a selective disclosure presentation from a wallet credential.
   * Used for identity circuit inputs.
   * Requires authentication (holder must own the credential).
   */
  createPresentation: protectedProcedure
    .input(createWalletPresentationInput)
    .mutation(async ({ ctx, input }) => {
      const credential = deserializeCredential(
        input.credential as SerializedBbsCredential
      );

      const expectedHolderDid = `did:key:user-${ctx.userId}`;
      if (credential.holder !== expectedHolderDid) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Credential does not belong to authenticated user",
        });
      }

      const isValid = await verifyCredential(credential);
      if (!isValid) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Invalid credential signature",
        });
      }

      const presentation = await createPresentation(
        credential,
        input.revealClaims as (typeof WALLET_CREDENTIAL_CLAIM_ORDER)[number][],
        input.verifierNonce
      );

      return {
        presentation: serializePresentation(presentation),
      };
    }),

  /**
   * Verify a BBS+ wallet presentation.
   * Public endpoint - anyone can verify.
   */
  verifyPresentation: publicProcedure
    .input(verifyWalletPresentationInput)
    .mutation(async ({ input }) => {
      const presentation = deserializePresentation(
        input.presentation as SerializedBbsPresentation
      );

      const result = await verifyBbsPresentation(presentation);

      return {
        verified: result.verified,
        error: result.error,
        revealedClaims: result.verified ? presentation.revealedClaims : null,
      };
    }),

  /**
   * Get the issuer's public key.
   * Public endpoint for verifiers to cache the issuer key.
   */
  getIssuerPublicKey: publicProcedure.query(async () => {
    const issuerKeyPair = await getIssuerKeyPair();
    return {
      did: ISSUER_DID,
      publicKey: bytesToBase64(issuerKeyPair.publicKey),
    };
  }),
});

export const zkRouter = router({
  health: healthProcedure,
  verifyProof: verifyProofProcedure,
  createProofSession: createProofSessionProcedure,
  createChallenge: createChallengeProcedure,
  challengeStatus: challengeStatusProcedure,
  getChecks: getChecksProcedure,
  getProofs: getProofsProcedure,
  getSignedClaims: getSignedClaimsProcedure,
  storeProof: storeProofProcedure,
  bbs: bbsRouter,
});
