import "server-only";

import z from "zod";

import {
  clearAnonymousFlag,
  linkWalletAddress,
  updateUserEmail,
} from "@/lib/db/queries/auth";
import { upsertIdentityBundle } from "@/lib/db/queries/identity";

import { protectedProcedure, router } from "../server";

const ISSUER_ID = "zentity";
const POLICY_VERSION = "1.0";

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

      await Promise.all([
        email
          ? updateUserEmail(ctx.userId, email)
          : clearAnonymousFlag(ctx.userId),
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
          status: "pending",
          issuerId: ISSUER_ID,
          policyVersion: POLICY_VERSION,
          walletAddress: wallet?.address ?? null,
        }),
      ]);

      return { success: true };
    }),
});
