import "server-only";

import { z } from "zod";

import {
  cleanupExpiredKeys,
  rotateSigningKey,
} from "@/lib/auth/oidc/jwt-signer";
import { processIdentityValidityDeliveries } from "@/lib/identity/validity/delivery";

import { adminProcedure, router } from "../server";

const algSchema = z.enum(["RS256", "ES256", "EdDSA"]);

export const adminRouter = router({
  rotateSigningKey: adminProcedure
    .input(
      z.object({
        alg: algSchema,
        overlapHours: z.number().int().min(1).max(720).default(24),
      })
    )
    .mutation(({ input }) => rotateSigningKey(input.alg, input.overlapHours)),

  cleanupExpiredKeys: adminProcedure.mutation(async () => {
    const deleted = await cleanupExpiredKeys();
    return { deleted };
  }),

  retryPendingRevocations: adminProcedure.mutation(() =>
    processIdentityValidityDeliveries({
      targets: ["blockchain_attestation_revocation"],
    })
  ),
});
