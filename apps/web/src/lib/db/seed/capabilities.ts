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
    name: "read_profile",
    description: "Read the user's identity profile and verification status",
    approvalStrength: "session",
    inputSchema: null,
    outputSchema: JSON.stringify({
      type: "object",
      properties: {
        name: { type: "string" },
        email: { type: "string" },
        tier: { type: "number" },
        verified: { type: "boolean" },
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
    name: "request_approval",
    description:
      "Request explicit user approval for a sensitive action via push notification",
    approvalStrength: "session",
    inputSchema: JSON.stringify({
      type: "object",
      properties: {
        action: { type: "string" },
        details: { type: "string" },
      },
      required: ["action"],
    }),
    outputSchema: JSON.stringify({
      type: "object",
      properties: {
        approved: { type: "boolean" },
      },
    }),
  },
] as const;

/**
 * Seed agent capabilities (idempotent — uses INSERT OR IGNORE).
 */
export async function ensureCapabilitiesSeeded(): Promise<void> {
  await db
    .insert(agentCapabilities)
    .values(
      CAPABILITIES.map((c) => ({
        name: c.name,
        description: c.description,
        approvalStrength: c.approvalStrength,
        inputSchema: c.inputSchema,
        outputSchema: c.outputSchema,
      }))
    )
    .onConflictDoNothing();
}

/** Default capabilities stored as durable host policies. */
export const DEFAULT_HOST_POLICY_CAPABILITIES = [
  "check_compliance",
  "request_approval",
];

/** Additional capabilities auto-granted for vendor-attested hosts. */
export const ATTESTED_HOST_POLICY_CAPABILITIES = [
  ...DEFAULT_HOST_POLICY_CAPABILITIES,
  "read_profile",
];
