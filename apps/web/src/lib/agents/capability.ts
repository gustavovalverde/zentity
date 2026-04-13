/**
 * Capability resolution for agent authorization.
 *
 * Pure helpers that map an authorization request (scopes + RAR
 * authorization_details) to a single canonical capability name, and look up
 * the approval strength configured for that capability.
 *
 * Extracted from approval-evaluate.ts to break the import cycle with
 * agents/session.ts (which needs deriveCapabilityName / resolveCapabilityApprovalStrength).
 */

import { eq } from "drizzle-orm";

import {
  extractProofScopes,
  isIdentityScope,
} from "@/lib/auth/oidc/disclosure/registry";
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

export function deriveCapabilityName(
  details: AuthorizationDetail[],
  scope: string
): string | null {
  // Precedence is strict so a mixed request produces one deterministic
  // capability: purchase details outrank identity scopes, which outrank proof
  // scopes, which outrank openid-only requests.
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
