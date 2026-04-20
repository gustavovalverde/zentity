import "server-only";

import { TRPCError } from "@trpc/server";
import z from "zod";

import { auth } from "@/lib/auth/auth-config";
import {
  clearAnonymousFlag,
  deleteStaleAnonymousUserByEmail,
  linkWalletAddress,
  updateUserEmail,
  updateUserWalletIdentity,
} from "@/lib/db/queries/auth";
import { upsertIdentityBundle } from "@/lib/db/queries/identity";
import { logError } from "@/lib/logging/error-logger";

import { protectedProcedure, router } from "../server";

const BUNDLE_ISSUER_ID = "zentity";
const BUNDLE_POLICY_VERSION = "1.0";

function isUniqueConstraintError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  if ("code" in error && error.code === "SQLITE_CONSTRAINT_UNIQUE") {
    return true;
  }
  return error.message.includes("UNIQUE constraint failed");
}

export const signUpRouter = router({
  completeAccountCreation: protectedProcedure
    .input(
      z
        .object({
          email: z.email().optional(),
          wallet: z
            .object({
              address: z.string().min(1),
              chainId: z.number().int().positive(),
            })
            .optional(),
        })
        .optional()
    )
    .mutation(async ({ ctx, input }) => {
      const email = input?.email?.trim() || null;
      const wallet = input?.wallet;

      // Clean up stale anonymous users from previous incomplete signup attempts
      if (email) {
        await deleteStaleAnonymousUserByEmail(email, ctx.userId);
      }

      let identityUpdate: Promise<void>;
      if (email) {
        identityUpdate = updateUserEmail(ctx.userId, email);
      } else if (wallet) {
        identityUpdate = updateUserWalletIdentity(ctx.userId, wallet.address);
      } else {
        identityUpdate = clearAnonymousFlag(ctx.userId);
      }

      try {
        await Promise.all([
          identityUpdate,
          wallet
            ? linkWalletAddress({
                userId: ctx.userId,
                address: wallet.address,
                chainId: wallet.chainId,
                isPrimary: true,
              })
            : Promise.resolve(),
          upsertIdentityBundle({
            userId: ctx.userId,
            validityStatus: "pending",
            issuerId: BUNDLE_ISSUER_ID,
            policyVersion: BUNDLE_POLICY_VERSION,
            walletAddress: wallet?.address ?? null,
          }),
        ]);
      } catch (error) {
        if (isUniqueConstraintError(error)) {
          logError(error, {
            requestId: ctx.requestId,
            path: "signUp.completeAccountCreation",
          });
          const ref = ctx.requestId.slice(0, 8);
          throw new TRPCError({
            code: "CONFLICT",
            message: `Unable to complete account creation. Please try again. (Ref: ${ref})`,
          });
        }
        throw error;
      }

      if (email) {
        auth.api
          .sendVerificationEmail({
            body: { email, callbackURL: "/dashboard" },
          })
          .catch(() => undefined);
      }

      return { success: true };
    }),
});
