import "server-only";

import crypto from "node:crypto";

import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getAuthenticationStateBySessionId } from "@/lib/auth/auth-context";
import { db } from "@/lib/db/connection";
import { upsertCredentialBindingCommitment } from "@/lib/db/queries/privacy";
import { encryptedSecrets, secretWrappers } from "@/lib/db/schema/privacy";

import { protectedProcedure, router } from "../server";

const CREDENTIAL_BINDING_FRESHNESS_MS = 5 * 60 * 1000;

const credentialKindSchema = z.enum(["passkey", "opaque", "wallet"]);
const credentialBindingCommitmentSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]+$/)
  .transform((value) => value.toLowerCase());

function expectedLoginMethod(kind: z.infer<typeof credentialKindSchema>) {
  return kind === "wallet" ? "eip712" : kind;
}

function expectedKekSource(kind: z.infer<typeof credentialKindSchema>) {
  return kind === "passkey" ? "prf" : kind;
}

export const credentialBindingsRouter = router({
  register: protectedProcedure
    .input(
      z.object({
        secretId: z.string().min(1),
        credentialId: z.string().min(1),
        credentialKind: credentialKindSchema,
        credentialBindingCommitment: credentialBindingCommitmentSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      const authContext =
        (await getAuthenticationStateBySessionId(ctx.session.session.id)) ??
        ctx.authContext ??
        null;
      const expectedMethod = expectedLoginMethod(input.credentialKind);
      if (authContext?.loginMethod !== expectedMethod) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Fresh credential confirmation is required.",
        });
      }

      const authenticatedAtMs = authContext.authenticatedAt * 1000;
      if (Date.now() - authenticatedAtMs > CREDENTIAL_BINDING_FRESHNESS_MS) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Credential confirmation expired. Please try again.",
        });
      }

      const wrapper = await db
        .select({ secretId: secretWrappers.secretId })
        .from(secretWrappers)
        .innerJoin(
          encryptedSecrets,
          eq(encryptedSecrets.id, secretWrappers.secretId)
        )
        .where(
          and(
            eq(encryptedSecrets.id, input.secretId),
            eq(encryptedSecrets.userId, ctx.userId),
            eq(encryptedSecrets.secretType, "fhe_keys"),
            eq(secretWrappers.credentialId, input.credentialId),
            eq(
              secretWrappers.kekSource,
              expectedKekSource(input.credentialKind)
            )
          )
        )
        .limit(1)
        .get();

      if (!wrapper) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Credential binding must match an enrolled FHE key wrapper.",
        });
      }

      const commitment = await upsertCredentialBindingCommitment({
        id: crypto.randomUUID(),
        secretId: input.secretId,
        userId: ctx.userId,
        credentialId: input.credentialId,
        credentialKind: input.credentialKind,
        commitment: input.credentialBindingCommitment,
        authContextId: authContext.id,
      });

      return { credentialBindingId: commitment.id };
    }),
});
