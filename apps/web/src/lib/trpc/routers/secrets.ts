/**
 * Encrypted Secrets Router
 *
 * Stores credential-wrapped secrets without server access to plaintext.
 * Unlocking credentials wrap only the vault root; every other secret is
 * wrapped under the vault key.
 */
import "server-only";

import { TRPCError } from "@trpc/server";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { getAuthenticationStateBySessionId } from "@/lib/auth/auth-context";
import { db } from "@/lib/db/connection";
import { clearIdentityBundleFheKey } from "@/lib/db/queries/identity";
import {
  deleteVaultSecrets,
  detachVaultCredential,
  getEncryptedSecretByUserAndType,
  getSecretWrappersBySecretId,
  updateEncryptedSecretMetadata,
  upsertSecretWrapper,
} from "@/lib/db/queries/privacy";
import { encryptedSecrets, secretWrappers } from "@/lib/db/schema/privacy";
import {
  kekSourceSchema,
  prfSaltSchema,
  RECOVERY_KEY_CREDENTIAL_ID,
  secretTypeSchema,
  unlockingKekSourceSchema,
  VAULT_KEY_CREDENTIAL_ID,
  VAULT_ROOT_SECRET_TYPE,
  wrappedDekSchema,
} from "@/lib/privacy/secrets/catalog";
import {
  computeSecretBlobRef,
  deleteSecretBlob,
  getSecretBlobMaxBytes,
  isValidSecretBlobRef,
} from "@/lib/privacy/secrets/storage.server";
import { getVaultAccess } from "@/lib/privacy/secrets/vault-access";

import { protectedProcedure, router } from "../server";

const metadataSchema = z.record(z.string(), z.unknown()).nullable().optional();
const sha256HexSchema = z.string().regex(/^[a-fA-F0-9]{64}$/);

const VAULT_RESET_FRESHNESS_MS = 15 * 60 * 1000;

function assertUnlockingWrapper(input: {
  credentialId: string;
  kekSource: z.infer<typeof unlockingKekSourceSchema>;
  prfSalt?: string | undefined;
}) {
  const valid =
    (input.kekSource === "prf" && Boolean(input.prfSalt)) ||
    (input.kekSource === "opaque" && input.credentialId === "opaque") ||
    (input.kekSource === "wallet" &&
      input.credentialId.startsWith("wallet:")) ||
    (input.kekSource === "recovery_key" &&
      input.credentialId === RECOVERY_KEY_CREDENTIAL_ID);
  if (!valid) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Credential does not match its key source.",
    });
  }
}

function assertWrapperForSecretType(input: {
  credentialId: string;
  kekSource: z.infer<typeof kekSourceSchema>;
  prfSalt?: string | undefined;
  secretType: z.infer<typeof secretTypeSchema>;
}) {
  if (input.secretType !== VAULT_ROOT_SECRET_TYPE) {
    if (
      input.kekSource !== "vault" ||
      input.credentialId !== VAULT_KEY_CREDENTIAL_ID
    ) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Vault secrets must be wrapped under the vault key.",
      });
    }
    return;
  }

  const kekSource = unlockingKekSourceSchema.safeParse(input.kekSource);
  if (!kekSource.success || kekSource.data === "recovery_key") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "The vault root must be wrapped by a sign-in credential.",
    });
  }
  assertUnlockingWrapper({ ...input, kekSource: kekSource.data });
}

async function requireVaultRoot(userId: string) {
  const root = await getEncryptedSecretByUserAndType(
    userId,
    VAULT_ROOT_SECRET_TYPE
  );
  if (!root) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Encryption keys are not set up.",
    });
  }
  return root;
}

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

  access: protectedProcedure.query(({ ctx }) => getVaultAccess(ctx.userId)),

  storeSecret: protectedProcedure
    .input(
      z.object({
        secretId: z.string().min(1),
        secretType: secretTypeSchema,
        blobRef: z.string().min(1),
        blobHash: sha256HexSchema,
        blobSize: z.number().int().nonnegative(),
        wrappedDek: wrappedDekSchema,
        prfSalt: prfSaltSchema.optional(),
        credentialId: z.string().min(1),
        metadata: metadataSchema,
        kekSource: kekSourceSchema,
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

      assertWrapperForSecretType(input);
      const isRoot = input.secretType === VAULT_ROOT_SECRET_TYPE;
      if (!isRoot) {
        await requireVaultRoot(ctx.userId);
      }

      const metadata = input.metadata ? JSON.stringify(input.metadata) : null;

      const replacedSecretIds = await db.transaction(async (tx) => {
        const existing = await tx
          .select({ id: encryptedSecrets.id })
          .from(encryptedSecrets)
          .where(
            and(
              eq(encryptedSecrets.userId, ctx.userId),
              eq(encryptedSecrets.secretType, input.secretType)
            )
          )
          .limit(1)
          .get();

        let replaced: string[] = [];
        if (existing && existing.id !== input.secretId) {
          if (isRoot) {
            // A new vault key orphans every secret wrapped under the old one.
            replaced = await deleteVaultSecrets(ctx.userId, tx);
          } else {
            await tx
              .delete(secretWrappers)
              .where(eq(secretWrappers.secretId, existing.id))
              .run();
            await tx
              .delete(encryptedSecrets)
              .where(eq(encryptedSecrets.id, existing.id))
              .run();
            replaced = [existing.id];
          }
        }

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

        await tx
          .insert(secretWrappers)
          .values({
            id: crypto.randomUUID(),
            secretId: input.secretId,
            userId: ctx.userId,
            credentialId: input.credentialId,
            wrappedDek: input.wrappedDek,
            prfSalt: input.prfSalt ?? null,
            kekSource: input.kekSource,
          })
          .onConflictDoUpdate({
            target: [secretWrappers.secretId, secretWrappers.credentialId],
            set: {
              wrappedDek: input.wrappedDek,
              prfSalt: input.prfSalt ?? null,
              kekSource: input.kekSource,
              updatedAt: sql`datetime('now')`,
            },
          })
          .run();

        return replaced;
      });

      await Promise.all(
        replacedSecretIds
          .filter((id) => id !== input.secretId)
          .map((id) => deleteSecretBlob(computeSecretBlobRef(id)))
      );

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
        credentialId: z.string().min(1),
        wrappedDek: wrappedDekSchema,
        prfSalt: prfSaltSchema.optional(),
        kekSource: unlockingKekSourceSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      assertUnlockingWrapper(input);
      const root = await requireVaultRoot(ctx.userId);
      if (root.id !== input.secretId) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Encryption keys changed. Please try again.",
        });
      }

      const wrapper = await upsertSecretWrapper({
        id: crypto.randomUUID(),
        secretId: root.id,
        userId: ctx.userId,
        credentialId: input.credentialId,
        wrappedDek: input.wrappedDek,
        prfSalt: input.prfSalt,
        kekSource: input.kekSource,
      });

      return { wrapper };
    }),

  removeCredential: protectedProcedure
    .input(z.object({ credentialId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const root = await requireVaultRoot(ctx.userId);
      const wrappers = await getSecretWrappersBySecretId(root.id);

      if (!wrappers.some((w) => w.credentialId === input.credentialId)) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "This credential does not unlock your encrypted data.",
        });
      }

      const remaining = wrappers.filter(
        (w) => w.credentialId !== input.credentialId
      );
      if (remaining.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Add another way to open your encrypted data before removing this one.",
        });
      }

      await detachVaultCredential(ctx.userId, input.credentialId);
      return { success: true };
    }),

  resetVault: protectedProcedure.mutation(async ({ ctx }) => {
    const authState =
      (await getAuthenticationStateBySessionId(ctx.session.session.id)) ??
      ctx.authContext ??
      null;
    if (
      !authState ||
      Date.now() - authState.authenticatedAt * 1000 > VAULT_RESET_FRESHNESS_MS
    ) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Sign in again to start over with new keys.",
      });
    }

    const deletedSecretIds = await deleteVaultSecrets(ctx.userId);
    await clearIdentityBundleFheKey(ctx.userId);
    await Promise.all(
      deletedSecretIds.map((id) => deleteSecretBlob(computeSecretBlobRef(id)))
    );

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
