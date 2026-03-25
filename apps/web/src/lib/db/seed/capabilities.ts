import { notInArray } from "drizzle-orm";

import { db } from "@/lib/db/connection";
import { agentCapabilities } from "@/lib/db/schema/agent";

const CAPABILITIES = [
  {
    name: "purchase",
    description: "Authorize and execute purchases on behalf of the user",
    approvalStrength: "biometric",
    inputSchema: JSON.stringify({
      type: "object",
      properties: {
        item: { type: "string" },
        merchant: { type: "string" },
        amount: {
          type: "object",
          properties: {
            value: { type: "string" },
            currency: { type: "string" },
          },
        },
      },
      required: ["item", "merchant", "amount"],
    }),
    outputSchema: JSON.stringify({
      type: "object",
      properties: {
        approved: { type: "boolean" },
        pii: {
          type: "object",
          properties: {
            name: { type: "string" },
            address: { type: "string" },
          },
        },
      },
    }),
  },
  {
    name: "my_profile",
    description:
      "Read vault-gated profile fields such as full name, address, birthdate, or email",
    approvalStrength: "session",
    inputSchema: JSON.stringify({
      type: "object",
      properties: {
        fields: {
          type: "array",
          items: {
            type: "string",
            enum: ["name", "address", "birthdate", "email"],
          },
        },
      },
    }),
    outputSchema: JSON.stringify({
      type: "object",
      properties: {
        status: { type: "string" },
        profile: { type: "object" },
        requestedFields: { type: "array", items: { type: "string" } },
        returnedFields: { type: "array", items: { type: "string" } },
      },
    }),
  },
  {
    name: "check_compliance",
    description: "Check the user's on-chain attestation and compliance status",
    approvalStrength: "none",
    inputSchema: null,
    outputSchema: JSON.stringify({
      type: "object",
      properties: {
        attested: { type: "boolean" },
        networks: { type: "array", items: { type: "string" } },
      },
    }),
  },
  {
    name: "my_proofs",
    description:
      "Read proof inventory and verification-derived facts such as age status and verification method",
    approvalStrength: "none",
    inputSchema: null,
    outputSchema: JSON.stringify({
      type: "object",
      properties: {
        verificationMethod: { type: "string" },
        verificationLevel: { type: "string" },
        verified: { type: "boolean" },
        proofs: { type: "array", items: { type: "object" } },
      },
    }),
  },
  {
    name: "whoami",
    description:
      "Read a safe account summary such as email, verification tier, login method, and completed checks",
    approvalStrength: "none",
    inputSchema: null,
    outputSchema: JSON.stringify({
      type: "object",
      properties: {
        email: { type: "string" },
        verificationLevel: { type: "string" },
        tier: { type: "number" },
        checks: { type: "object" },
      },
    }),
  },
] as const;

/**
 * Seed agent capabilities and prune stale definitions to keep the
 * server-side catalog aligned with the public MCP tool surface.
 */
export async function ensureCapabilitiesSeeded(): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(agentCapabilities).where(
      notInArray(
        agentCapabilities.name,
        CAPABILITIES.map((capability) => capability.name)
      )
    );

    for (const capability of CAPABILITIES) {
      await tx
        .insert(agentCapabilities)
        .values({
          name: capability.name,
          description: capability.description,
          approvalStrength: capability.approvalStrength,
          inputSchema: capability.inputSchema,
          outputSchema: capability.outputSchema,
        })
        .onConflictDoUpdate({
          target: agentCapabilities.name,
          set: {
            description: capability.description,
            approvalStrength: capability.approvalStrength,
            inputSchema: capability.inputSchema,
            outputSchema: capability.outputSchema,
          },
        });
    }
  });
}

/** Default capabilities stored as durable host policies. */
export const DEFAULT_HOST_POLICY_CAPABILITIES = [
  "whoami",
  "my_proofs",
  "check_compliance",
];

/**
 * Attested hosts currently keep the same silent-approval defaults. Attestation
 * is surfaced in UI, tokens, and introspection instead of silently widening
 * identity-disclosure capabilities.
 */
export const ATTESTED_HOST_POLICY_CAPABILITIES = [
  ...DEFAULT_HOST_POLICY_CAPABILITIES,
];
