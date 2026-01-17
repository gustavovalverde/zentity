import crypto from "node:crypto";

import { TRPCError } from "@trpc/server";
import { z } from "zod";

import {
  getEncryptedSecretById,
  listEncryptedSecretsByUserId,
} from "@/lib/db/queries/crypto";
import {
  createRecoveryGuardian,
  deleteRecoveryGuardian,
  getRecoveryConfigByUserId,
  getRecoveryGuardianByEmail,
  getRecoveryGuardianById,
  getRecoveryGuardianByType,
  listRecoveryGuardiansByConfigId,
  listRecoveryWrappersByUserId,
  upsertRecoverySecretWrapper,
} from "@/lib/db/queries/recovery";
import { getTwoFactorByUserId } from "@/lib/db/queries/two-factor";
import { RECOVERY_GUARDIAN_TYPE_TWO_FACTOR } from "@/lib/recovery/constants";

import { protectedProcedure } from "../../server";

export const listGuardiansProcedure = protectedProcedure.query(
  async ({ ctx }) => {
    const config = await getRecoveryConfigByUserId(ctx.userId);
    if (!config) {
      return { guardians: [] };
    }
    const guardians = await listRecoveryGuardiansByConfigId(config.id);
    return { guardians };
  }
);

export const removeGuardianProcedure = protectedProcedure
  .input(z.object({ guardianId: z.string().min(1) }))
  .mutation(async ({ ctx, input }) => {
    const config = await getRecoveryConfigByUserId(ctx.userId);
    if (!config) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Enable recovery before managing guardians.",
      });
    }

    const guardian = await getRecoveryGuardianById(input.guardianId);
    if (!guardian || guardian.recoveryConfigId !== config.id) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Guardian not found.",
      });
    }

    await deleteRecoveryGuardian(guardian.id);
    return { guardianId: guardian.id, guardianType: guardian.guardianType };
  });

export const addGuardianEmailProcedure = protectedProcedure
  .input(z.object({ email: z.email() }))
  .mutation(async ({ ctx, input }) => {
    const config = await getRecoveryConfigByUserId(ctx.userId);
    if (!config) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Enable recovery before adding guardians.",
      });
    }

    const normalizedEmail = input.email.trim().toLowerCase();
    const existing = await getRecoveryGuardianByEmail({
      recoveryConfigId: config.id,
      email: normalizedEmail,
    });
    if (existing) {
      return { guardian: existing, created: false };
    }

    const guardians = await listRecoveryGuardiansByConfigId(config.id);
    if (guardians.length >= config.totalGuardians) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "All guardian slots are already filled.",
      });
    }

    const assignedIndices = new Set(guardians.map((g) => g.participantIndex));
    let participantIndex = 1;
    while (
      participantIndex <= config.totalGuardians &&
      assignedIndices.has(participantIndex)
    ) {
      participantIndex += 1;
    }

    if (participantIndex > config.totalGuardians) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "No guardian slots available.",
      });
    }

    const guardian = await createRecoveryGuardian({
      id: crypto.randomUUID(),
      recoveryConfigId: config.id,
      email: normalizedEmail,
      participantIndex,
    });

    return { guardian, created: true };
  });

export const addGuardianTwoFactorProcedure = protectedProcedure.mutation(
  async ({ ctx }) => {
    const config = await getRecoveryConfigByUserId(ctx.userId);
    if (!config) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Enable recovery before adding guardians.",
      });
    }

    const existing = await getRecoveryGuardianByType({
      recoveryConfigId: config.id,
      guardianType: RECOVERY_GUARDIAN_TYPE_TWO_FACTOR,
    });
    if (existing) {
      return { guardian: existing, created: false };
    }

    const twoFactor = await getTwoFactorByUserId(ctx.userId);
    if (!twoFactor) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Enable two-factor authentication before linking a guardian.",
      });
    }

    const guardians = await listRecoveryGuardiansByConfigId(config.id);
    if (guardians.length >= config.totalGuardians) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "All guardian slots are already filled.",
      });
    }

    const assignedIndices = new Set(guardians.map((g) => g.participantIndex));
    let participantIndex = 1;
    while (
      participantIndex <= config.totalGuardians &&
      assignedIndices.has(participantIndex)
    ) {
      participantIndex += 1;
    }

    if (participantIndex > config.totalGuardians) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "No guardian slots available.",
      });
    }

    const guardian = await createRecoveryGuardian({
      id: crypto.randomUUID(),
      recoveryConfigId: config.id,
      email: "authenticator",
      guardianType: RECOVERY_GUARDIAN_TYPE_TWO_FACTOR,
      participantIndex,
    });

    return { guardian, created: true };
  }
);

export const wrappersStatusProcedure = protectedProcedure.query(
  async ({ ctx }) => {
    const secrets = await listEncryptedSecretsByUserId(ctx.userId);
    const wrappers = await listRecoveryWrappersByUserId(ctx.userId);
    const wrappedIds = new Set(wrappers.map((wrapper) => wrapper.secretId));

    const entries = secrets.map((secret) => ({
      secretId: secret.id,
      secretType: secret.secretType,
      hasWrapper: wrappedIds.has(secret.id),
    }));

    const wrappedCount = entries.filter((entry) => entry.hasWrapper).length;

    return {
      totalSecrets: entries.length,
      wrappedCount,
      secrets: entries,
    };
  }
);

export const storeSecretWrapperProcedure = protectedProcedure
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

    const wrapper = await upsertRecoverySecretWrapper({
      id: crypto.randomUUID(),
      userId: ctx.userId,
      secretId: secret.id,
      wrappedDek: input.wrappedDek,
      keyId: input.keyId,
    });

    return { stored: true, wrapper };
  });
