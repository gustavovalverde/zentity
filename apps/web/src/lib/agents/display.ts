/**
 * Human-readable labels and formatters for agent concepts.
 * Pure data — no React, no server-only — importable from both server and client components.
 */

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
  unverified: "Unverified",
};

export function formatCapabilityName(name: string): string {
  return CAPABILITY_LABELS[name] ?? name;
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

  const parsed =
    typeof constraints === "string"
      ? (() => {
          try {
            return JSON.parse(constraints) as unknown;
          } catch {
            return null;
          }
        })()
      : constraints;

  if (!isConstraintArray(parsed) || parsed.length === 0) {
    return null;
  }

  return parsed.map(formatSingleConstraint).join("; ");
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
