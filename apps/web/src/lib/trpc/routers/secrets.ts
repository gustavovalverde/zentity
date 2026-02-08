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
  deleteSecretWrapper,
  getEncryptedSecretByUserAndType,
  getSecretWrappersBySecretId,
  updateEncryptedSecretMetadata,
  upsertEncryptedSecret,
  upsertSecretWrapper,
} from "@/lib/db/queries/crypto";
import {
  computeSecretBlobRef,
  getSecretBlobMaxBytes,
  isValidSecretBlobRef,
} from "@/lib/privacy/secrets/storage.server";
import { secretTypeSchema } from "@/lib/privacy/secrets/types";
import { base64ToBytes } from "@/lib/utils/base64";

import { protectedProcedure, router } from "../server";

const metadataSchema = z.record(z.string(), z.unknown()).nullable().optional();
const sha256HexSchema = z.string().regex(/^[a-fA-F0-9]{64}$/);

const wrappedDekSchema = z
  .string()
  .min(1)
  .refine(
    (val) => {
      try {
        const parsed = JSON.parse(val);
        return parsed.alg && parsed.iv && parsed.ciphertext;
      } catch {
        return false;
      }
    },
    { message: "wrappedDek must be a JSON object with {alg, iv, ciphertext}" }
  );

const prfSaltSchema = z.string().refine(
  (val) => {
    if (!val) {
      return true;
    }
    try {
      return base64ToBytes(val).byteLength === 32;
    } catch {
      return false;
    }
  },
  { message: "prfSalt must be base64-encoded 32 bytes" }
);

export const secretsRouter = router({
  getPasskeyUser: protectedProcedure.query(({ ctx }) => ({
    userId: ctx.userId,
    email: ctx.session.user.email,
    displayName: ctx.session.user.email,
  })),

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
        blobHash: sha256HexSchema,
        blobSize: z.number().int().nonnegative(),
        wrappedDek: wrappedDekSchema,
        prfSalt: prfSaltSchema,
        credentialId: z.string().min(1),
        metadata: metadataSchema,
        kekSource: z.enum(["prf", "opaque", "wallet", "recovery"]).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const expectedBlobRef = computeSecretBlobRef(input.secretId);
      const normalizedBlobRef = input.blobRef.trim().toLowerCase();
      if (
        !isValidSecretBlobRef(normalizedBlobRef) ||
        normalizedBlobRef !== expectedBlobRef
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Invalid blob reference.",
        });
      }

      const maxBytes = getSecretBlobMaxBytes();
      if (input.blobSize > maxBytes) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Secret blob too large.",
        });
      }

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
        blobRef: expectedBlobRef,
        blobHash: input.blobHash.toLowerCase(),
        blobSize: input.blobSize,
        metadata: input.metadata ?? null,
      });

      const wrapper = await upsertSecretWrapper({
        id: crypto.randomUUID(),
        secretId: secret.id,
        userId: ctx.userId,
        credentialId: input.credentialId,
        wrappedDek: input.wrappedDek,
        prfSalt: input.prfSalt,
        kekSource: input.kekSource,
      });

      return { secret, wrapper };
    }),

  addWrapper: protectedProcedure
    .input(
      z.object({
        secretId: z.string().min(1),
        secretType: secretTypeSchema,
        credentialId: z.string().min(1),
        wrappedDek: wrappedDekSchema,
        prfSalt: prfSaltSchema.optional(),
        kekSource: z.enum(["prf", "opaque", "wallet", "recovery"]).optional(),
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
        kekSource: input.kekSource,
      });

      return { wrapper };
    }),

  removeWrapper: protectedProcedure
    .input(
      z.object({
        secretId: z.string().min(1),
        credentialId: z.string().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const wrappers = await getSecretWrappersBySecretId(input.secretId);

      const wrapper = wrappers.find(
        (w) => w.credentialId === input.credentialId && w.userId === ctx.userId
      );
      if (!wrapper) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Wrapper not found for user.",
        });
      }

      // Prevent removing the last wrapper
      const userWrappers = wrappers.filter((w) => w.userId === ctx.userId);
      if (userWrappers.length <= 1) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot remove the last wrapper for a secret.",
        });
      }

      await deleteSecretWrapper(input.secretId, input.credentialId);

      return { success: true };
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
        ...existing.metadata,
        ...input.metadata,
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
