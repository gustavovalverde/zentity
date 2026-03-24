import { z } from "zod";

// Keep this schema aligned with
// apps/web/src/lib/auth/oidc/agent-registration-contract.ts.
export const registerHostRequestSchema = z.object({
  publicKey: z.string().min(1),
  name: z.string().min(1).max(255),
});

export const registerHostResponseSchema = z.object({
  hostId: z.string().min(1),
  created: z.boolean(),
  attestation_tier: z
    .enum(["attested", "self-declared", "unverified"])
    .optional(),
});

export const agentDisplaySchema = z.object({
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

export const registerSessionGrantSchema = z.object({
  capability: z.string().min(1),
  status: z.string().min(1),
});

export const registerSessionResponseSchema = z.object({
  sessionId: z.string().min(1),
  status: z.string().min(1),
  grants: z.array(registerSessionGrantSchema).default([]),
});
