/**
 * Encrypted Secrets Router
 *
 * Stores passkey-wrapped secrets without server access to plaintext.
 */
import "server-only";

import { TRPCError } from "@trpc/server";
import { z } from "zod";

import {
  deleteEncryptedSecretByUserAndType,
  getEncryptedSecretByUserAndType,
  getSecretWrappersBySecretId,
  updateEncryptedSecretMetadata,
  upsertEncryptedSecret,
  upsertSecretWrapper,
} from "@/lib/db/queries/crypto";

import { protectedProcedure, router } from "../server";

const secretTypeSchema = z.string().min(1);

const metadataSchema = z.record(z.string(), z.unknown()).nullable().optional();

export const secretsRouter = router({
  getPasskeyUser: protectedProcedure.query(({ ctx }) => {
    const name = ctx.session.user.name || ctx.session.user.email;
    return {
      userId: ctx.userId,
      email: ctx.session.user.email,
      displayName: name,
    };
  }),

  getSecretBundle: protectedProcedure
    .input(z.object({ secretType: secretTypeSchema }))
    .query(async ({ ctx, input }) => {
      const secret = await getEncryptedSecretByUserAndType(
        ctx.userId,
        input.secretType
      );
      if (!secret) {
        return { secret: null, wrappers: [] };
      }

      const wrappers = await getSecretWrappersBySecretId(secret.id);
      return { secret, wrappers };
    }),

  storeSecret: protectedProcedure
    .input(
      z.object({
        secretId: z.string().min(1),
        secretType: secretTypeSchema,
        blobRef: z.string().min(1),
        blobHash: z.string().min(1),
        blobSize: z.number().int().nonnegative(),
        wrappedDek: z.string().min(1),
        prfSalt: z.string().min(1),
        credentialId: z.string().min(1),
        metadata: metadataSchema,
        version: z.string().min(1),
        kekVersion: z.string().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await getEncryptedSecretByUserAndType(
        ctx.userId,
        input.secretType
      );

      if (existing && existing.id !== input.secretId) {
        await deleteEncryptedSecretByUserAndType(ctx.userId, input.secretType);
      }

      const secret = await upsertEncryptedSecret({
        id: input.secretId,
        userId: ctx.userId,
        secretType: input.secretType,
        encryptedBlob: "",
        blobRef: input.blobRef,
        blobHash: input.blobHash,
        blobSize: input.blobSize,
        metadata: input.metadata ?? null,
        version: input.version,
      });

      const wrapper = await upsertSecretWrapper({
        id: crypto.randomUUID(),
        secretId: secret.id,
        userId: ctx.userId,
        credentialId: input.credentialId,
        wrappedDek: input.wrappedDek,
        prfSalt: input.prfSalt,
        kekVersion: input.kekVersion,
      });

      return { secret, wrapper };
    }),

  addWrapper: protectedProcedure
    .input(
      z.object({
        secretId: z.string().min(1),
        secretType: secretTypeSchema,
        credentialId: z.string().min(1),
        wrappedDek: z.string().min(1),
        prfSalt: z.string().min(1),
        kekVersion: z.string().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const secret = await getEncryptedSecretByUserAndType(
        ctx.userId,
        input.secretType
      );
      if (!secret || secret.id !== input.secretId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Secret not found for user.",
        });
      }

      const wrapper = await upsertSecretWrapper({
        id: crypto.randomUUID(),
        secretId: secret.id,
        userId: ctx.userId,
        credentialId: input.credentialId,
        wrappedDek: input.wrappedDek,
        prfSalt: input.prfSalt,
        kekVersion: input.kekVersion,
      });

      return { wrapper };
    }),

  updateSecretMetadata: protectedProcedure
    .input(
      z.object({
        secretType: secretTypeSchema,
        metadata: metadataSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await getEncryptedSecretByUserAndType(
        ctx.userId,
        input.secretType
      );
      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Secret not found.",
        });
      }

      const mergedMetadata = {
        ...(existing.metadata ?? {}),
        ...(input.metadata ?? {}),
      };

      const updated = await updateEncryptedSecretMetadata({
        userId: ctx.userId,
        secretType: input.secretType,
        metadata: mergedMetadata,
      });

      if (!updated) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Secret not found.",
        });
      }

      return { secret: updated };
    }),
});
