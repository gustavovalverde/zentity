/**
 * Encrypted Secrets Router
 *
 * Stores passkey-wrapped secrets without server access to plaintext.
 */
import "server-only";

import { TRPCError } from "@trpc/server";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/lib/db/connection";
import {
  deleteSecretWrapper,
  getEncryptedSecretByUserAndType,
  getSecretWrappersBySecretId,
  updateEncryptedSecretMetadata,
  upsertSecretWrapper,
} from "@/lib/db/queries/crypto";
import { encryptedSecrets, secretWrappers } from "@/lib/db/schema/crypto";
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

const wrappedDekJsonSchema = z.object({
  alg: z.string().min(1),
  iv: z.string().min(1),
  ciphertext: z.string().min(1),
});

const wrappedDekSchema = z
  .string()
  .min(1)
  .refine(
    (val) => {
      try {
        return wrappedDekJsonSchema.safeParse(JSON.parse(val)).success;
      } catch {
        return false;
      }
    },
    {
      message:
        "wrappedDek must be a JSON object with {alg, iv, ciphertext} as non-empty strings",
    }
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

      const metadata = input.metadata ? JSON.stringify(input.metadata) : null;

      const result = await db.transaction(async (tx) => {
        // Delete any existing secret with a different id for this user+type
        const existing = await tx
          .select()
          .from(encryptedSecrets)
          .where(
            and(
              eq(encryptedSecrets.userId, ctx.userId),
              eq(encryptedSecrets.secretType, input.secretType)
            )
          )
          .limit(1)
          .get();

        if (existing && existing.id !== input.secretId) {
          await tx
            .delete(encryptedSecrets)
            .where(
              and(
                eq(encryptedSecrets.userId, ctx.userId),
                eq(encryptedSecrets.secretType, input.secretType)
              )
            )
            .run();
        }

        // Upsert the secret
        await tx
          .insert(encryptedSecrets)
          .values({
            id: input.secretId,
            userId: ctx.userId,
            secretType: input.secretType,
            encryptedBlob: "",
            blobRef: expectedBlobRef,
            blobHash: input.blobHash.toLowerCase(),
            blobSize: input.blobSize,
            metadata,
          })
          .onConflictDoUpdate({
            target: [encryptedSecrets.userId, encryptedSecrets.secretType],
            set: {
              encryptedBlob: "",
              blobRef: expectedBlobRef,
              blobHash: input.blobHash.toLowerCase(),
              blobSize: input.blobSize,
              metadata,
              updatedAt: sql`datetime('now')`,
            },
          })
          .run();

        // Upsert the wrapper
        const kekSource = input.kekSource ?? "prf";
        await tx
          .insert(secretWrappers)
          .values({
            id: crypto.randomUUID(),
            secretId: input.secretId,
            userId: ctx.userId,
            credentialId: input.credentialId,
            wrappedDek: input.wrappedDek,
            prfSalt: input.prfSalt ?? null,
            kekSource,
          })
          .onConflictDoUpdate({
            target: [secretWrappers.secretId, secretWrappers.credentialId],
            set: {
              wrappedDek: input.wrappedDek,
              prfSalt: input.prfSalt ?? null,
              kekSource,
              updatedAt: sql`datetime('now')`,
            },
          })
          .run();

        return true;
      });

      if (!result) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to store secret.",
        });
      }

      // Read back outside transaction using existing query functions
      // (which parse metadata from JSON string to object)
      const secret = await getEncryptedSecretByUserAndType(
        ctx.userId,
        input.secretType
      );
      const wrappers = secret
        ? await getSecretWrappersBySecretId(secret.id)
        : [];
      const wrapper = wrappers.find(
        (w) => w.credentialId === input.credentialId
      );

      if (!(secret && wrapper)) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to store secret.",
        });
      }

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
