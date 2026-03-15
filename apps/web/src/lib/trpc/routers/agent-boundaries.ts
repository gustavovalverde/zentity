import "server-only";

import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { isIdentityScope } from "@/lib/auth/oidc/identity-scopes";
import { db } from "@/lib/db/connection";
import { agentBoundaries } from "@/lib/db/schema/agent-boundaries";
import { oauthClients } from "@/lib/db/schema/oauth-provider";

import { protectedProcedure, router } from "../server";

const purchaseConfigSchema = z.object({
  maxAmount: z.number().positive(),
  currency: z.string().min(1),
  dailyCap: z.number().positive(),
  cooldownMinutes: z.number().int().min(0),
});

const scopeConfigSchema = z
  .object({
    allowedScopes: z.array(z.string().min(1)).min(1),
  })
  .refine((config) => !config.allowedScopes.some(isIdentityScope), {
    message: "Identity scopes cannot be auto-approved",
  });

const customConfigSchema = z.object({
  actionType: z.string().min(1),
  dailyCount: z.number().int().positive(),
});

const boundaryTypeSchema = z.enum(["purchase", "scope", "custom"]);

function parseConfig(type: string, config: unknown) {
  switch (type) {
    case "purchase":
      return purchaseConfigSchema.parse(config);
    case "scope":
      return scopeConfigSchema.parse(config);
    case "custom":
      return customConfigSchema.parse(config);
    default:
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Invalid boundary type: ${type}`,
      });
  }
}

export const agentBoundariesRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const rows = await db
      .select({
        id: agentBoundaries.id,
        clientId: agentBoundaries.clientId,
        boundaryType: agentBoundaries.boundaryType,
        config: agentBoundaries.config,
        enabled: agentBoundaries.enabled,
        createdAt: agentBoundaries.createdAt,
        updatedAt: agentBoundaries.updatedAt,
        clientName: oauthClients.name,
      })
      .from(agentBoundaries)
      .leftJoin(
        oauthClients,
        eq(agentBoundaries.clientId, oauthClients.clientId)
      )
      .where(eq(agentBoundaries.userId, ctx.userId))
      .all();

    return rows.map((row) => ({
      ...row,
      config: JSON.parse(row.config) as Record<string, unknown>,
    }));
  }),

  create: protectedProcedure
    .input(
      z.object({
        clientId: z.string().min(1),
        boundaryType: boundaryTypeSchema,
        config: z.record(z.string(), z.unknown()),
        enabled: z.boolean().default(true),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const validated = parseConfig(input.boundaryType, input.config);

      const [row] = await db
        .insert(agentBoundaries)
        .values({
          userId: ctx.userId,
          clientId: input.clientId,
          boundaryType: input.boundaryType,
          config: JSON.stringify(validated),
          enabled: input.enabled,
        })
        .returning();

      return row;
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string().min(1),
        config: z.record(z.string(), z.unknown()).optional(),
        enabled: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await db
        .select()
        .from(agentBoundaries)
        .where(
          and(
            eq(agentBoundaries.id, input.id),
            eq(agentBoundaries.userId, ctx.userId)
          )
        )
        .get();

      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      const updates: Record<string, unknown> = {
        updatedAt: new Date(),
      };

      if (input.config !== undefined) {
        const validated = parseConfig(existing.boundaryType, input.config);
        updates.config = JSON.stringify(validated);
      }

      if (input.enabled !== undefined) {
        updates.enabled = input.enabled;
      }

      const [updated] = await db
        .update(agentBoundaries)
        .set(updates)
        .where(
          and(
            eq(agentBoundaries.id, input.id),
            eq(agentBoundaries.userId, ctx.userId)
          )
        )
        .returning();

      return updated;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const deleted = await db
        .delete(agentBoundaries)
        .where(
          and(
            eq(agentBoundaries.id, input.id),
            eq(agentBoundaries.userId, ctx.userId)
          )
        )
        .returning({ id: agentBoundaries.id });

      if (deleted.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      return { deleted: true };
    }),
});
