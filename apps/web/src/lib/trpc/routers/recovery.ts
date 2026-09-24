import "server-only";

import crypto from "node:crypto";

import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { getEncryptedSecretById } from "@/lib/db/queries/privacy";
import {
  getRecoveryConfigByUserId,
  getRecoveryKeyPin,
  pinRecoveryKey,
  upsertRecoverySecretWrapper,
} from "@/lib/db/queries/recovery";
import {
  getRecoveryKeyFingerprint,
  getRecoveryPublicKey,
} from "@/lib/recovery/keys";

import { protectedProcedure, publicProcedure, router } from "../server";

const publicKeyProcedure = publicProcedure.query(() => getRecoveryPublicKey());

const storeSecretWrapperProcedure = protectedProcedure
  .input(
    z.object({
      secretId: z.string().min(1),
      wrappedDek: z.string().min(1),
      keyId: z.string().min(1),
    })
  )
  .mutation(async ({ ctx, input }) => {
    const secret = await getEncryptedSecretById(ctx.userId, input.secretId);
    if (!secret) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Secret not found for user.",
      });
    }

    const config = await getRecoveryConfigByUserId(ctx.userId);
    if (!config) {
      return { stored: false };
    }

    const fingerprint = getRecoveryKeyFingerprint();
    const existingPin = await getRecoveryKeyPin(ctx.userId);

    if (existingPin && existingPin.keyFingerprint !== fingerprint) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          "Recovery key has changed since enrollment. This may indicate a key substitution attack.",
      });
    }

    if (!existingPin) {
      await pinRecoveryKey({
        id: crypto.randomUUID(),
        userId: ctx.userId,
        keyFingerprint: fingerprint,
      });
    }

    const wrapper = await upsertRecoverySecretWrapper({
      id: crypto.randomUUID(),
      userId: ctx.userId,
      secretId: secret.id,
      wrappedDek: input.wrappedDek,
      keyId: input.keyId,
    });

    return { stored: true, wrapper };
  });

export const recoveryRouter = router({
  publicKey: publicKeyProcedure,
  storeSecretWrapper: storeSecretWrapperProcedure,
});
