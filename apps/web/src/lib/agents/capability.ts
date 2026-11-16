/**
 * Agent capability domain.
 *
 * Owns the capability catalog synced into agent_capabilities, the approval
 * policy that maps a whole CIBA request (scopes plus RAR
 * authorization_details) to the ceremony it needs, and the durable
 * host-policy defaults.
 *
 * Kept separate from approval-evaluate.ts to avoid an import cycle with
 * agents/session.ts.
 */

import {
  IDENTITY_STRENGTHS,
  PAYMENT_AUTHORIZATION_CAPABILITY,
  PAYMENT_AUTHORIZATION_TYPE,
  PURCHASE_TYPE,
  X402_PURCHASE_TYPE,
} from "@zentity/sdk/protocol";
import { notInArray } from "drizzle-orm";

import { isIdentityScope } from "@/lib/auth/oidc/disclosure/registry";
import { db } from "@/lib/db/connection";
import { agentCapabilities } from "@/lib/db/schema/agent";

export interface AuthorizationDetail {
  amount?: { currency?: string; value?: string };
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

// ─── Capability catalog ─────────────────────────────────────────────

/**
 * How a person approves a request by hand: an active session, or a passkey
 * assertion with the user-verified flag set (PIN or biometric, which the
 * relying party cannot tell apart).
 */
export type ApprovalCeremony = "session" | "user_verification";

interface CapabilityDefinition {
  /** The ceremony a manual approval needs. */
  approvalStrength: ApprovalCeremony;
  description: string;
  /** Whether an agent session grant may approve it without the user. */
  grantable: boolean;
  inputSchema: Record<string, unknown> | null;
  name: string;
  outputSchema: Record<string, unknown>;
}

const CAPABILITIES = [
  {
    name: "purchase",
    description:
      "Buy from a named merchant with the user's approval (purchase), or prove to an x402 merchant that the user's identity is verified (x402_purchase)",
    approvalStrength: "user_verification",
    grantable: false,
    inputSchema: {
      oneOf: [
        {
          type: "object",
          additionalProperties: false,
          properties: {
            type: { const: PURCHASE_TYPE },
            merchant: {
              type: "object",
              additionalProperties: false,
              properties: {
                name: { type: "string", minLength: 1, maxLength: 64 },
              },
              required: ["name"],
            },
            item: { type: "string", minLength: 1, maxLength: 120 },
            amount: {
              type: "object",
              additionalProperties: false,
              properties: {
                value: { type: "string", pattern: "^\\d{1,12}(\\.\\d{1,4})?$" },
                currency: { type: "string", pattern: "^[A-Z]{3}$" },
              },
              required: ["value", "currency"],
            },
          },
          required: ["type", "merchant", "item", "amount"],
        },
        {
          type: "object",
          additionalProperties: false,
          properties: {
            type: { const: X402_PURCHASE_TYPE },
            resource_url: { type: "string", format: "uri" },
            resource_description: {
              type: "string",
              minLength: 1,
              maxLength: 256,
            },
            payment_requirements: {
              type: "object",
              description:
                "The x402 v2 exact payment requirement the merchant advertised, copied verbatim",
              additionalProperties: false,
              properties: {
                scheme: { const: "exact" },
                network: { type: "string" },
                amount: { type: "string", pattern: "^[1-9][0-9]{0,77}$" },
                asset: { type: "string" },
                payTo: { type: "string" },
                maxTimeoutSeconds: {
                  type: "integer",
                  minimum: 1,
                  maximum: 3600,
                },
                extra: { type: "object" },
              },
              required: [
                "scheme",
                "network",
                "amount",
                "asset",
                "payTo",
                "maxTimeoutSeconds",
              ],
            },
            min_identity_strength: {
              type: "string",
              enum: [...IDENTITY_STRENGTHS],
            },
          },
          required: [
            "type",
            "resource_url",
            "payment_requirements",
            "min_identity_strength",
          ],
        },
      ],
    },
    outputSchema: {
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
    },
  },
  {
    name: "my_profile",
    description:
      "Read vault-gated profile fields such as full name, address, or birthdate",
    approvalStrength: "session",
    grantable: false,
    inputSchema: {
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
    },
    outputSchema: {
      type: "object",
      properties: {
        status: { type: "string" },
        profile: { type: "object" },
        requestedFields: { type: "array", items: { type: "string" } },
        returnedFields: { type: "array", items: { type: "string" } },
      },
    },
  },
  {
    name: "check_compliance",
    description: "Check the user's on-chain attestation and compliance status",
    approvalStrength: "session",
    grantable: true,
    inputSchema: null,
    outputSchema: {
      type: "object",
      properties: {
        attested: { type: "boolean" },
        networks: { type: "array", items: { type: "string" } },
      },
    },
  },
  {
    name: "my_proofs",
    description:
      "Read verification-derived facts such as age status, verification checks, and verification method",
    approvalStrength: "session",
    grantable: true,
    inputSchema: null,
    outputSchema: {
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
    },
  },
  {
    name: "whoami",
    description:
      "Read a safe account summary such as verification tier, login method, completed checks, and standard account email when the granted scopes include email",
    approvalStrength: "session",
    grantable: true,
    inputSchema: null,
    outputSchema: {
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
    },
  },
  {
    name: PAYMENT_AUTHORIZATION_CAPABILITY,
    description:
      "Mint a payment_authorization RAR entry bounding a single on-chain spend (chain, recipient, amount, expiry, intent_hash)",
    // A bounded grant may approve a spend within its limits (see
    // isBoundedPaymentGrant); any other spend goes to the user, who confirms
    // it with a user-verified passkey assertion.
    approvalStrength: "user_verification",
    grantable: true,
    inputSchema: {
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
    },
    outputSchema: {
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
    },
  },
] as const satisfies readonly CapabilityDefinition[];

const CAPABILITY_CATALOG = new Map<string, CapabilityDefinition>(
  CAPABILITIES.map((capability) => [capability.name, capability])
);

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
          grantable: capability.grantable,
          inputSchema: capability.inputSchema,
          outputSchema: capability.outputSchema,
        })
        .onConflictDoUpdate({
          target: agentCapabilities.name,
          set: {
            description: capability.description,
            approvalStrength: capability.approvalStrength,
            grantable: capability.grantable,
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

// ─── Approval policy ────────────────────────────────────────────────

/** What one requested scope or RAR type needs before it is approved. */
interface ApprovalPolicyRow {
  /** The capability a grant must hold to approve it, or null for none. */
  capability: string | null;
  ceremony: ApprovalCeremony;
  /** Whether a capability grant may approve it without the user. */
  grantable: boolean;
  /** Whether a notification may approve it, because its label says enough. */
  inline: boolean;
  /** Short noun phrase that names what is shared, for notifications. */
  label: string;
}

/** Ceremony and grantability come from the catalog entry of the capability. */
function policyRow(
  capability: string | null,
  inline: boolean,
  label: string
): ApprovalPolicyRow {
  const entry = capability ? CAPABILITY_CATALOG.get(capability) : undefined;
  return {
    capability,
    ceremony: entry?.approvalStrength ?? "session",
    grantable: entry?.grantable ?? false,
    inline,
    label,
  };
}

/**
 * The single list of what each scope and RAR type needs. Every approval
 * surface (grant evaluation, the decision endpoint, push, and the approval
 * page) reads it through `approvalPolicy`.
 */
const APPROVAL_POLICY = {
  scopes: {
    openid: policyRow(null, true, "sign-in"),
    "compliance:read": policyRow("check_compliance", true, "compliance status"),
    "proof:identity": policyRow("my_proofs", true, "verification records"),
    "proof:verification": policyRow("my_proofs", true, "verification status"),
    "proof:age": policyRow("my_proofs", true, "age proof"),
    "proof:document": policyRow("my_proofs", true, "document verification"),
    "proof:liveness": policyRow("my_proofs", true, "selfie check results"),
    "proof:nationality": policyRow(
      "my_proofs",
      true,
      "nationality verification"
    ),
    "proof:compliance": policyRow("my_proofs", true, "verification policy"),
    "proof:chip": policyRow("my_proofs", true, "passport chip verification"),
    "proof:humanity": policyRow("my_proofs", true, "proof you are human"),
    "identity.name": policyRow("my_profile", false, "full legal name"),
    "identity.dob": policyRow("my_profile", false, "date of birth"),
    "identity.address": policyRow("my_profile", false, "residential address"),
    "identity.document": policyRow("my_profile", false, "document details"),
    "identity.nationality": policyRow("my_profile", false, "nationality"),
    email: policyRow(null, false, "email address"),
    offline_access: policyRow(null, false, "access while you are away"),
    "proof:sybil": policyRow(null, false, "anonymous ID for this app"),
    "proof:humanity:rp_unique": policyRow(
      null,
      false,
      "anonymous human ID for this app"
    ),
    "agent:host.register": policyRow(null, false, "agent host registration"),
    "agent:session.register": policyRow(
      null,
      false,
      "agent session registration"
    ),
    "agent:session.revoke": policyRow(null, false, "agent session removal"),
    "agent:introspect": policyRow(null, false, "agent status"),
    identity_verification: policyRow(null, false, "verification credential"),
    poh: policyRow("purchase", false, "proof of human for a merchant"),
  } satisfies Record<string, ApprovalPolicyRow>,
  authorizationDetails: {
    [PAYMENT_AUTHORIZATION_TYPE]: policyRow(
      PAYMENT_AUTHORIZATION_CAPABILITY,
      false,
      "payment"
    ),
    [PURCHASE_TYPE]: policyRow("purchase", false, "purchase"),
    [X402_PURCHASE_TYPE]: policyRow(
      "purchase",
      false,
      "proof of human for a merchant"
    ),
  } satisfies Record<string, ApprovalPolicyRow>,
} as const;

const SCOPE_POLICY: Readonly<Record<string, ApprovalPolicyRow>> =
  APPROVAL_POLICY.scopes;
const AUTHORIZATION_DETAILS_POLICY: Readonly<
  Record<string, ApprovalPolicyRow>
> = APPROVAL_POLICY.authorizationDetails;

/** Unknown scopes go to the page, where the user sees the raw name. */
function unknownScopeRow(scope: string): ApprovalPolicyRow {
  return {
    capability: null,
    ceremony: "session",
    grantable: false,
    inline: false,
    label: scope,
  };
}

/** Details Zentity cannot read need the strongest ceremony. */
const UNKNOWN_DETAIL_ROW: ApprovalPolicyRow = {
  capability: null,
  ceremony: "user_verification",
  grantable: false,
  inline: false,
  label: "unrecognized request details",
};

export interface ScopeLabel {
  /** Whether a notification may approve this item inline. */
  inline: boolean;
  label: string;
  scope: string;
}

export interface ApprovalPolicy {
  /** The strictest ceremony any requested item needs. */
  ceremony: ApprovalCeremony;
  /** The one capability a grant may approve the whole request with. */
  grantCapability: string | null;
  hasIdentityScopes: boolean;
  inlineApprove: boolean;
  /** A label for every requested scope other than `openid`. */
  labels: ScopeLabel[];
  /** Whether only the approval page may approve it. */
  pageOnly: boolean;
}

interface ApprovalRequest {
  /** RFC 9396 details as stored (a JSON string) or as parsed. */
  authorizationDetails?: unknown;
  scope: string;
}

function detailTypes(raw: unknown): (string | null)[] {
  if (raw === undefined || raw === null || raw === "") {
    return [];
  }
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      return [null];
    }
  }
  if (!Array.isArray(parsed)) {
    return [null];
  }
  return parsed.map((entry: unknown) => {
    const type =
      entry && typeof entry === "object"
        ? (entry as { type?: unknown }).type
        : undefined;
    return typeof type === "string" ? type : null;
  });
}

function requestedScopes(request: ApprovalRequest): string[] {
  return [...new Set(request.scope.split(" ").filter(Boolean))].filter(
    (scope) => scope !== "openid"
  );
}

function policyRows(request: ApprovalRequest) {
  const scopes = requestedScopes(request);
  const scopeRows = scopes.map(
    (scope) => SCOPE_POLICY[scope] ?? unknownScopeRow(scope)
  );
  const detailRows = detailTypes(request.authorizationDetails).map((type) =>
    type
      ? (AUTHORIZATION_DETAILS_POLICY[type] ?? UNKNOWN_DETAIL_ROW)
      : UNKNOWN_DETAIL_ROW
  );
  return { scopes, scopeRows, detailRows, rows: [...scopeRows, ...detailRows] };
}

/** The catalog capabilities a request asks for, by name. */
export function requestCapabilities(request: ApprovalRequest): string[] {
  const names = policyRows(request).rows.flatMap((row) =>
    row.capability ? [row.capability] : []
  );
  return [...new Set(names)].toSorted();
}

/**
 * Derives what the whole request needs from what it asks for, never from
 * anything the agent asserts about itself.
 */
export function approvalPolicy(request: ApprovalRequest): ApprovalPolicy {
  const { scopes, scopeRows, detailRows, rows } = policyRows(request);

  const ceremony: ApprovalCeremony = rows.some(
    (row) => row.ceremony === "user_verification"
  )
    ? "user_verification"
    : "session";
  const pageOnly =
    detailRows.length > 0 ||
    ceremony === "user_verification" ||
    rows.some((row) => !row.inline);

  const capabilities = new Set(rows.map((row) => row.capability));
  const allGrantable = rows.every((row) => row.grantable);
  const [onlyCapability] = capabilities;
  const grantCapability =
    rows.length > 0 && allGrantable && capabilities.size === 1
      ? (onlyCapability ?? null)
      : null;

  return {
    ceremony,
    grantCapability,
    hasIdentityScopes: scopes.some(isIdentityScope),
    inlineApprove: !pageOnly,
    labels: scopes.map((scope, index) => ({
      scope,
      label: scopeRows[index]?.label ?? scope,
      inline: scopeRows[index]?.inline ?? false,
    })),
    pageOnly,
  };
}

/**
 * The ceremony a manual approval needs from this user. Identity releases also
 * need user verification when the user has a passkey to give it with.
 */
export function requiredCeremony(
  policy: ApprovalPolicy,
  user: { hasPasskey: boolean }
): ApprovalCeremony {
  return policy.ceremony === "user_verification" ||
    (policy.hasIdentityScopes && user.hasPasskey)
    ? "user_verification"
    : "session";
}
