import { z } from "zod";

// Keep this schema aligned with apps/mcp/src/auth/agent-registration-contract.ts.
export const registerHostRequestSchema = z.object({
  publicKey: z.string().min(1),
  name: z.string().min(1).max(255),
});

const agentDisplaySchema = z.object({
  model: z.string().max(128).optional(),
  name: z.string().min(1).max(128),
  runtime: z.string().max(128).optional(),
  version: z.string().max(64).optional(),
});

export const registerSessionRequestSchema = z.object({
  hostJwt: z.string().min(1),
  agentPublicKey: z.string().min(1),
  requestedCapabilities: z.array(z.string()).optional(),
  display: agentDisplaySchema,
});
