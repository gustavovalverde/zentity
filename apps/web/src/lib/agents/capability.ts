/**
 * Agent capability domain.
 *
 * Maps an authorization request (scopes + RAR authorization_details) to a
 * canonical capability name, resolves the configured approval strength, and
 * owns the canonical capability catalog synced into the agent_capabilities
 * table plus the durable host-policy defaults.
 *
 * Kept separate from approval-evaluate.ts to avoid an import cycle with
 * agents/session.ts (which needs deriveCapabilityName /
 * resolveCapabilityApprovalStrength).
 */

import {
  PAYMENT_AUTHORIZATION_CAPABILITY,
  PAYMENT_AUTHORIZATION_TYPE,
} from "@zentity/sdk/protocol";
import { eq, notInArray } from "drizzle-orm";

import {
  extractProofScopes,
  isIdentityScope,
} from "@/lib/auth/oidc/disclosure/registry";
import { db } from "@/lib/db/connection";
import { agentCapabilities } from "@/lib/db/schema/agent";

export interface AuthorizationDetail {
  amount?: { currency?: string; value?: string };
  item?: string;
  merchant?: string;
  type?: string;
  [key: string]: unknown;
}

export function normalizeAuthorizationDetails(
  raw: unknown
): AuthorizationDetail[] {
  if (Array.isArray(raw)) {
    return raw;
  }
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

export function deriveCapabilityName(
  details: AuthorizationDetail[],
  scope: string
): string | null {
  // Precedence is strict so a mixed request produces one deterministic
  // capability: a payment_authorization spend outranks purchase details, which
  // outrank identity scopes, which outrank proof scopes, which outrank
  // openid-only requests.
  if (details.some((detail) => detail.type === PAYMENT_AUTHORIZATION_TYPE)) {
    return PAYMENT_AUTHORIZATION_CAPABILITY;
  }

  if (details.some((detail) => detail.type === "purchase")) {
    return "purchase";
  }

  const scopes = scope.split(" ").filter((item) => item !== "openid");
  if (scopes.some(isIdentityScope)) {
    return "my_profile";
  }

  if (scopes.includes("compliance:key:read")) {
    return "check_compliance";
  }

  if (
    scopes.includes("proof:identity") ||
    extractProofScopes(scopes).length > 0
  ) {
    return "my_proofs";
  }

  return null;
}

export async function resolveCapabilityApprovalStrength(
  capabilityName: string | null | undefined
): Promise<string | undefined> {
  if (!capabilityName) {
    return undefined;
  }

  const capability = await db
    .select({ approvalStrength: agentCapabilities.approvalStrength })
    .from(agentCapabilities)
    .where(eq(agentCapabilities.name, capabilityName))
    .limit(1)
    .get();

  return capability?.approvalStrength;
}

// ─── Capability catalog ─────────────────────────────────────────────

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
      "Read vault-gated profile fields such as full name, address, or birthdate",
    approvalStrength: "session",
    inputSchema: JSON.stringify({
      type: "object",
      properties: {
        fields: {
          type: "array",
          items: {
            type: "string",
            enum: ["name", "address", "birthdate"],
          },
        },
      },
      required: ["fields"],
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
      "Read verification-derived facts such as age status, verification checks, and verification method",
    approvalStrength: "none",
    inputSchema: null,
    outputSchema: JSON.stringify({
      type: "object",
      properties: {
        verificationMethod: { type: ["string", "null"] },
        verificationLevel: { type: "string" },
        verified: { type: "boolean" },
        isOver18: { type: ["boolean", "null"] },
        checks: {
          type: "array",
          items: {
            type: "object",
            properties: {
              type: { type: "string" },
              passed: { type: "boolean" },
            },
          },
        },
      },
    }),
  },
  {
    name: "whoami",
    description:
      "Read a safe account summary such as verification tier, login method, completed checks, and standard account email when the granted scopes include email",
    approvalStrength: "none",
    inputSchema: null,
    outputSchema: JSON.stringify({
      type: "object",
      properties: {
        email: { type: ["string", "null"] },
        memberSince: { type: ["string", "null"] },
        tier: { type: ["number", "null"] },
        tierName: { type: ["string", "null"] },
        verificationLevel: { type: ["string", "null"] },
        authStrength: { type: ["string", "null"] },
        loginMethod: { type: ["string", "null"] },
        checks: { type: ["object", "null"] },
        vaultFieldsAvailable: {
          type: "array",
          items: {
            type: "string",
            enum: ["name", "address", "birthdate"],
          },
        },
        profileToolHint: { const: "my_profile", type: "string" },
      },
    }),
  },
  {
    name: PAYMENT_AUTHORIZATION_CAPABILITY,
    description:
      "Mint a payment_authorization RAR entry bounding a single on-chain spend (chain, recipient, amount, expiry, intent_hash)",
    // "none" lets grant evaluation reach the boundary + ledger check, so a
    // spend within a pre-authorized agent_session_grant auto-approves; over-limit
    // or unlisted-recipient spends fall through to manual CIBA approval.
    // "biometric" would dead-end evaluation before any boundary check, making
    // the capability unreachable.
    approvalStrength: "none",
    inputSchema: JSON.stringify({
      type: "object",
      properties: {
        chain: {
          type: "object",
          properties: {
            namespace: { type: "string", pattern: "^[-a-z0-9]{3,8}$" },
            reference: { type: "string", pattern: "^[-a-zA-Z0-9]{1,32}$" },
          },
          required: ["namespace", "reference"],
        },
        recipient: {
          type: "string",
          pattern: "^[-a-z0-9]{3,8}:[-a-zA-Z0-9]{1,32}:[a-zA-Z0-9]{1,512}$",
          description: "CAIP-10 account id",
        },
        amount: {
          type: "object",
          properties: {
            currency: { type: "string" },
            value: {
              type: "string",
              pattern: "^(0|[1-9][0-9]*)(\\.[0-9]+)?$",
              description:
                "Decimal-string in the unit identified by amount.unit (D-10)",
            },
            unit: { type: "string", enum: ["base", "display"] },
          },
          required: ["currency", "value", "unit"],
        },
        payment_id: { type: "string", minLength: 1, maxLength: 128 },
        intent_hash: {
          type: "string",
          pattern: "^v1:sha256:[A-Za-z0-9_-]{43}$",
          description: "Parsed-tuple SHA-256 binding (Proposal-0003 D-4)",
        },
        expires_at: {
          type: "object",
          properties: {
            kind: {
              type: "string",
              enum: [
                "block_height",
                "slot",
                "block_number",
                "timestamp_seconds",
              ],
            },
            value: { type: "integer", minimum: 0 },
          },
          required: ["kind", "value"],
        },
      },
      required: [
        "chain",
        "recipient",
        "amount",
        "payment_id",
        "intent_hash",
        "expires_at",
      ],
    }),
    outputSchema: JSON.stringify({
      type: "object",
      properties: {
        approved: { type: "boolean" },
        token: {
          type: "string",
          description:
            "DPoP-bound at+jwt with the payment_authorization RAR entry in authorization_details",
        },
        expires_at: { type: "string", format: "date-time" },
        jti: { type: "string" },
      },
    }),
  },
] as const;

/**
 * Sync the agent capability catalog into agent_capabilities and prune stale
 * definitions so the server-side catalog matches the public MCP tool surface.
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
 * Attested hosts keep the same silent-approval defaults; attestation is
 * surfaced in UI, tokens, and introspection instead of silently widening
 * identity-disclosure capabilities.
 */
export const ATTESTED_HOST_POLICY_CAPABILITIES = [
  ...DEFAULT_HOST_POLICY_CAPABILITIES,
];
