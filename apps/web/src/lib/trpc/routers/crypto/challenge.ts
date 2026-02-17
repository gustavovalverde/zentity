import z from "zod";

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

/**
 * Creates a challenge nonce for replay-resistant proof generation.
 * The nonce must be included in the proof's public inputs and will
 * be consumed on verification (single-use).
 */
export const createChallengeProcedure = protectedProcedure
  .input(z.object({ circuitType: circuitTypeSchema }))
  .mutation(async ({ ctx, input }) => {
    const challenge = await createChallenge(input.circuitType, {
      userId: ctx.userId,
      msgSender: ctx.userId,
      audience: resolveAudience(ctx.req),
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
