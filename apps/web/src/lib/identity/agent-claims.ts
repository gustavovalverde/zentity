import { z } from "zod";

import { logger } from "@/lib/logging/logger";

// AAP draft-aap-oauth-profile-01 §3 — seven structured JWT claim categories.
// Only agent.name is required; all other fields are optional.

const agentSchema = z.object({
  name: z.string().min(1).max(128),
  model: z.string().max(128).optional(),
  runtime: z.string().max(128).optional(),
  version: z.string().max(64).optional(),
  capabilities: z.array(z.string().max(64)).max(20).optional(),
});

const taskSchema = z.object({
  description: z.string().max(512).optional(),
  id: z.string().max(128).optional(),
});

const capabilitySchema = z.object({
  action: z.string().max(128),
  constraints: z.record(z.string(), z.unknown()).optional(),
});

const oversightSchema = z.object({
  requires_human_approval_for: z.array(z.string().max(64)).max(20).optional(),
  audit_level: z.enum(["none", "basic", "full"]).optional(),
});

const delegationSchema = z.object({
  depth: z.number().int().nonnegative().optional(),
  chain: z.array(z.string().max(256)).max(10).optional(),
  parent_jti: z.string().max(256).optional(),
});

const contextSchema = z.object({
  network_zone: z.string().max(128).optional(),
  time_windows: z.string().max(256).optional(),
  geo: z.string().max(64).optional(),
});

const auditSchema = z.object({
  trace_id: z.string().max(256).optional(),
  session_id: z.string().max(256).optional(),
});

export const agentClaimsSchema = z.object({
  agent: agentSchema,
  task: taskSchema.optional(),
  capabilities: z.array(capabilitySchema).max(10).optional(),
  oversight: oversightSchema.optional(),
  delegation: delegationSchema.optional(),
  context: contextSchema.optional(),
  audit: auditSchema.optional(),
});

export type AgentClaims = z.infer<typeof agentClaimsSchema>;

/**
 * Parse and validate agent claims from a raw JSON string.
 * Returns null on invalid input (with a logged warning).
 */
export function parseAgentClaims(raw: string): AgentClaims | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    const result = agentClaimsSchema.safeParse(parsed);
    if (!result.success) {
      logger.warn(
        { errors: result.error.issues },
        "Invalid agent claims — stripped"
      );
      return null;
    }
    return result.data;
  } catch {
    logger.warn("Malformed agent claims JSON — stripped");
    return null;
  }
}
