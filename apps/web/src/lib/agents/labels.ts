/**
 * Human-readable labels and formatters for agent concepts.
 * Pure data — no React, no server-only — importable from both server and client components.
 */

import {
  findRegisteredAsset,
  formatAtomic,
  PURCHASE_TYPE,
  PurchaseAuthorizationSchema,
  X402_PURCHASE_TYPE,
  X402PurchaseAuthorizationSchema,
} from "@zentity/sdk/protocol";

const CAPABILITY_LABELS: Record<string, string> = {
  check_compliance: "Check verification status",
  my_profile: "Read personal information",
  my_proofs: "View verification records",
  purchase: "Make purchases",
  whoami: "View basic account info",
};

const GRANT_SOURCE_LABELS: Record<string, string> = {
  host_policy: "Granted by default",
  session_elevation: "Requested by agent",
  session_once: "One-time",
};

const HOST_TIER_LABELS: Record<string, string> = {
  attested: "Verified",
  "self-declared": "Self-declared",
  unverified: "Unverified",
};

const ACR_PREFIX = "urn:zentity:assurance:";

const ACR_LABELS: Record<string, string> = {
  "tier-0": "Account created",
  "tier-1": "Requires basic verification",
  "tier-2": "Requires verified identity",
  "tier-3": "Requires chip-verified identity",
};

const IDENTITY_STRENGTH_LABELS: Record<string, string> = {
  documentary: "Document",
  documentary_full: "Document, full",
  cryptographic_chip: "Passport chip",
};

/** A merchant's identity-strength requirement in words, e.g. "Document, full". */
export function formatIdentityStrength(strength: string): string {
  return IDENTITY_STRENGTH_LABELS[strength] ?? strength;
}

export function formatCapabilityName(name: string): string {
  return CAPABILITY_LABELS[name] ?? name;
}

export function formatAcrValue(acr: string): string {
  const fragment = acr.startsWith(ACR_PREFIX)
    ? acr.slice(ACR_PREFIX.length)
    : acr;
  return ACR_LABELS[fragment] ?? `Assurance: ${fragment}`;
}

export function formatGrantSource(source: string): string {
  return GRANT_SOURCE_LABELS[source] ?? source;
}

export function formatHostTier(tier: string): string {
  return HOST_TIER_LABELS[tier] ?? tier;
}

interface Constraint {
  field: string;
  op: string;
  value?: unknown;
  values?: unknown[];
}

function isConstraintArray(v: unknown): v is Constraint[] {
  return (
    Array.isArray(v) &&
    v.every(
      (c) => typeof c === "object" && c !== null && "field" in c && "op" in c
    )
  );
}

function formatSingleConstraint(c: Constraint): string {
  const val = String(c.value ?? "");
  const vals = Array.isArray(c.values)
    ? c.values.map(String).join(", ")
    : String(c.values ?? "");

  switch (c.op) {
    case "max":
      return `Up to ${val} per action`;
    case "min":
      return `At least ${val}`;
    case "eq":
      return `${c.field} is ${val}`;
    case "in":
      return `${c.field} in ${vals}`;
    case "not_in":
      return `${c.field} not in ${vals}`;
    default:
      return `${c.field} ${c.op} ${val}`.trim();
  }
}

export function formatConstraints(constraints: unknown): string | null {
  if (constraints == null) {
    return null;
  }

  if (!isConstraintArray(constraints) || constraints.length === 0) {
    return null;
  }

  return constraints.map(formatSingleConstraint).join("; ");
}

export function formatUsageSummary(
  count: number,
  limitCount?: number | null,
  limitAmount?: number | null
): string {
  const parts: string[] = [];

  if (limitCount == null) {
    parts.push(`${count} ${count === 1 ? "action" : "actions"} today`);
  } else {
    parts.push(`${count} of ${limitCount} daily actions`);
  }

  if (limitAmount != null) {
    parts.push(`$${limitAmount} daily limit`);
  }

  return parts.join(" · ");
}

const ASSET_DECIMALS: Record<string, number> = {
  ZEC: 8,
};

const BASE_UNIT_AMOUNT_RE = /^\d+$/;
const TRAILING_ZEROS_RE = /0+$/;

export function formatPaymentAmount(amount: {
  currency: string;
  unit: "base" | "display";
  value: string;
}): string {
  if (amount.unit === "display") {
    return `${amount.value} ${amount.currency}`;
  }
  const decimals = ASSET_DECIMALS[amount.currency];
  if (decimals === undefined || !BASE_UNIT_AMOUNT_RE.test(amount.value)) {
    return `${amount.value} ${amount.currency} (base unit)`;
  }
  const scale = 10n ** BigInt(decimals);
  const baseUnits = BigInt(amount.value);
  const whole = (baseUnits / scale).toString();
  const fraction = (baseUnits % scale)
    .toString()
    .padStart(decimals, "0")
    .replace(TRAILING_ZEROS_RE, "");
  return `${fraction ? `${whole}.${fraction}` : whole} ${amount.currency}`;
}

// ─── Purchases ──────────────────────────────────────────────────────

/** Who stated a line: the agent, the merchant, or Zentity itself. */
type PurchaseLineSource = "agent" | "merchant" | "zentity";

interface PurchaseLine {
  /** "Stated by the agent" or "Described by the merchant", when not Zentity's. */
  label?: string;
  source: PurchaseLineSource;
  text: string;
}

export interface PurchaseDescription {
  /** What the user did, shown once the approval is recorded. */
  approvedText: string;
  lines: PurchaseLine[];
  /** One line for a push notification body, after the client name. */
  pushText: string;
  title: string;
}

const STATED_BY_AGENT = "Stated by the agent";
const DESCRIBED_BY_MERCHANT = "Described by the merchant";

/** An ISO 4217 amount in the currency's own notation, e.g. "€12.00". */
function formatCurrencyAmount(value: string, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 4,
    }).format(value as `${number}`);
  } catch {
    return `${value} ${currency}`;
  }
}

function shortenAddress(address: string): string {
  return address.length > 12
    ? `${address.slice(0, 6)}…${address.slice(-4)}`
    : address;
}

/**
 * What the user approves for a `purchase` or `x402_purchase` entry, in
 * server text, for the approval page, push, email, and Requests tab. Null for
 * any other entry, or one that no longer parses.
 *
 * An x402 approval is a Proof-of-Human for a named merchant: the merchant's
 * price is shown as its own statement, paid by the agent's wallet, because
 * Zentity does not sign or limit that payment.
 */
export function describePurchase(detail: unknown): PurchaseDescription | null {
  const type =
    detail && typeof detail === "object"
      ? (detail as { type?: unknown }).type
      : undefined;

  if (type === PURCHASE_TYPE) {
    const parsed = PurchaseAuthorizationSchema.safeParse(detail);
    if (!parsed.success) {
      return null;
    }
    const { item, merchant, amount } = parsed.data;
    const statement = `${item} from ${merchant.name}, ${formatCurrencyAmount(amount.value, amount.currency)}`;
    return {
      title: "Purchase",
      lines: [{ source: "agent", label: STATED_BY_AGENT, text: statement }],
      pushText: `Purchase stated by the agent: ${statement}`,
      approvedText: "You approved the purchase. The agent can now continue.",
    };
  }

  if (type === X402_PURCHASE_TYPE) {
    const parsed = X402PurchaseAuthorizationSchema.safeParse(detail);
    if (!parsed.success) {
      return null;
    }
    const entry = parsed.data;
    const merchant = new URL(entry.resource_url).host;
    const strength = formatIdentityStrength(entry.min_identity_strength);
    const requirement = entry.payment_requirements;
    const asset = findRegisteredAsset(requirement.network, requirement.asset);
    const price = asset
      ? `${formatAtomic(requirement.amount, asset)} ${asset.symbol} on ${asset.networkName}`
      : `${requirement.amount} base units of ${requirement.asset} on ${requirement.network}`;
    return {
      title: `Prove to ${merchant} that your identity is verified (${strength})`,
      lines: [
        ...(entry.resource_description
          ? [
              {
                source: "merchant" as const,
                label: DESCRIBED_BY_MERCHANT,
                text: entry.resource_description,
              },
            ]
          : []),
        {
          source: "merchant",
          text: `${merchant} charges ${price}, paid by the agent's own wallet to ${shortenAddress(requirement.payTo)}`,
        },
        {
          source: "zentity",
          text: "Zentity does not sign or limit this payment.",
        },
      ],
      pushText: `Prove your identity to ${merchant} (${strength})`,
      approvedText: `You proved to ${merchant} that your identity is verified. The agent can now continue.`,
    };
  }

  return null;
}
