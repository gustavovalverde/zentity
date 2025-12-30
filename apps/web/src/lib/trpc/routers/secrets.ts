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
} from "@/lib/db";

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
    .query(({ ctx, input }) => {
      const secret = getEncryptedSecretByUserAndType(
        ctx.userId,
        input.secretType,
      );
      if (!secret) {
        return { secret: null, wrappers: [] };
      }

      const wrappers = getSecretWrappersBySecretId(secret.id);
      return { secret, wrappers };
    }),

  storeSecret: protectedProcedure
    .input(
      z.object({
        secretId: z.string().min(1),
        secretType: secretTypeSchema,
        encryptedBlob: z.string().min(1),
        wrappedDek: z.string().min(1),
        prfSalt: z.string().min(1),
        credentialId: z.string().min(1),
        metadata: metadataSchema,
        version: z.string().min(1),
        kekVersion: z.string().min(1),
      }),
    )
    .mutation(({ ctx, input }) => {
      const existing = getEncryptedSecretByUserAndType(
        ctx.userId,
        input.secretType,
      );

      if (existing && existing.id !== input.secretId) {
        deleteEncryptedSecretByUserAndType(ctx.userId, input.secretType);
      }

      const secret = upsertEncryptedSecret({
        id: input.secretId,
        userId: ctx.userId,
        secretType: input.secretType,
        encryptedBlob: input.encryptedBlob,
        metadata: input.metadata ?? null,
        version: input.version,
      });

      const wrapper = upsertSecretWrapper({
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
      }),
    )
    .mutation(({ ctx, input }) => {
      const secret = getEncryptedSecretByUserAndType(
        ctx.userId,
        input.secretType,
      );
      if (!secret || secret.id !== input.secretId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Secret not found for user.",
        });
      }

      const wrapper = upsertSecretWrapper({
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
      }),
    )
    .mutation(({ ctx, input }) => {
      const existing = getEncryptedSecretByUserAndType(
        ctx.userId,
        input.secretType,
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

      const updated = updateEncryptedSecretMetadata({
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
