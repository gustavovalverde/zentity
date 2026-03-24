import { TRPCError } from "@trpc/server";
import z from "zod";

import { POLICY_VERSION } from "@/lib/blockchain/attestation/policy";
import {
  createProofSession,
  getProofSessionById,
} from "@/lib/db/queries/crypto";
import { getSelectedVerification } from "@/lib/db/queries/identity";
import {
  createChallenge,
  getActiveChallengeCount,
} from "@/lib/privacy/zk/challenge-store";

import { protectedProcedure } from "../../server";
import { resolveAudience } from "./audience";

export const circuitTypeSchema = z.enum([
  "age_verification",
  "doc_validity",
  "nationality_membership",
  "face_match",
  "identity_binding",
]);

const PROOF_SESSION_TTL_MS = 15 * 60 * 1000;

export const createProofSessionProcedure = protectedProcedure
  .input(z.object({ verificationId: z.string().optional() }).optional())
  .mutation(async ({ ctx, input }) => {
    const selectedVerification = await getSelectedVerification(ctx.userId);
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
export const createChallengeProcedure = protectedProcedure
  .input(
    z.object({
      circuitType: circuitTypeSchema,
      proofSessionId: z.string().uuid(),
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

export const challengeStatusProcedure = protectedProcedure.query(async () => ({
  activeChallenges: await getActiveChallengeCount(),
  supportedCircuitTypes: circuitTypeSchema.options,
  ttlMinutes: 15,
}));
