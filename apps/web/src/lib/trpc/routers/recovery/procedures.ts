import crypto from "node:crypto";

import { z } from "zod";

import {
  createRecoveryConfig,
  createRecoveryIdentifier,
  getRecoveryConfigByUserId,
  getRecoveryIdentifierByUserId,
  getRecoveryIdentifierByValue,
} from "@/lib/db/queries/recovery";
import { createRecoveryKeySet } from "@/lib/recovery/frost-service";
import { getRecoveryPublicKey } from "@/lib/recovery/recovery-keys";

import { protectedProcedure, publicProcedure } from "../../server";
import { generateRecoveryId } from "./verification";

const ciphersuiteSchema = z.enum(["secp256k1", "ed25519"]).default("secp256k1");

async function ensureRecoveryIdentifier(
  userId: string
): Promise<{ recoveryId: string; createdAt: string }> {
  const existing = await getRecoveryIdentifierByUserId(userId);
  if (existing) {
    return { recoveryId: existing.recoveryId, createdAt: existing.createdAt };
  }

  let recoveryId = generateRecoveryId();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const collision = await getRecoveryIdentifierByValue(recoveryId);
    if (!collision) {
      break;
    }
    recoveryId = generateRecoveryId();
  }

  const created = await createRecoveryIdentifier({
    id: crypto.randomUUID(),
    userId,
    recoveryId,
  });

  return { recoveryId: created.recoveryId, createdAt: created.createdAt };
}

export const publicKeyProcedure = publicProcedure.query(() => {
  return getRecoveryPublicKey();
});

export const configProcedure = protectedProcedure.query(async ({ ctx }) => {
  const config = await getRecoveryConfigByUserId(ctx.userId);
  return { config };
});

export const identifierProcedure = protectedProcedure.query(
  async ({ ctx }) => await ensureRecoveryIdentifier(ctx.userId)
);

export const setupProcedure = protectedProcedure
  .input(
    z.object({
      threshold: z.number().int().min(2).max(5).optional(),
      totalGuardians: z.number().int().min(2).max(5).optional(),
      ciphersuite: ciphersuiteSchema.optional(),
    })
  )
  .mutation(async ({ ctx, input }) => {
    const existing = await getRecoveryConfigByUserId(ctx.userId);
    if (existing) {
      return { config: existing, created: false };
    }

    const keySet = await createRecoveryKeySet({
      threshold: input.threshold,
      totalGuardians: input.totalGuardians,
      ciphersuite: input.ciphersuite,
    });

    const config = await createRecoveryConfig({
      id: crypto.randomUUID(),
      userId: ctx.userId,
      threshold: keySet.threshold,
      totalGuardians: keySet.totalGuardians,
      frostGroupPubkey: keySet.groupPubkey,
      frostPublicKeyPackage: keySet.publicKeyPackage,
      frostCiphersuite: keySet.ciphersuite,
      status: "active",
    });

    return { config, created: true };
  });
