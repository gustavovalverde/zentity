import "server-only";

import { z } from "zod";

import {
  cleanupExpiredKeys,
  rotateSigningKey,
} from "@/lib/auth/oidc/jwt-signer";
import { listIdentityValiditySourceCursors } from "@/lib/db/queries/identity-validity";
import { ingestChainRevocations } from "@/lib/identity/validity/chain-ingest";
import { deliverPendingValidityDeliveries } from "@/lib/identity/validity/delivery";
import { markDueIdentitiesStale } from "@/lib/identity/validity/freshness-worker";

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

  getIdentityValiditySourceCursors: adminProcedure.query(() =>
    listIdentityValiditySourceCursors()
  ),

  retryPendingRevocations: adminProcedure.mutation(() =>
    deliverPendingValidityDeliveries({
      targets: ["blockchain_attestation_revocation"],
    })
  ),

  ingestChainRevocations: adminProcedure
    .input(
      z.object({
        networkId: z.string().min(1),
        fromBlock: z.number().int().nonnegative().optional(),
      })
    )
    .mutation(({ input }) =>
      ingestChainRevocations({
        networkId: input.networkId,
        ...(input.fromBlock === undefined
          ? {}
          : { fromBlock: input.fromBlock }),
      })
    ),

  markDueIdentitiesStale: adminProcedure
    .input(
      z.object({
        limit: z.number().int().positive().max(500).optional(),
      })
    )
    .mutation(({ input }) =>
      markDueIdentitiesStale(
        input.limit === undefined ? {} : { limit: input.limit }
      )
    ),
});
