/**
 * Step-Up Authentication — CIBA acr_values enforcement
 *
 * Enforces acr_values at two points in the CIBA flow:
 * 1. Approval time — prevents user from approving if their tier is insufficient
 * 2. Token exchange — safety net if tier decreased between approval and polling
 */

import type { LibSQLDatabase } from "drizzle-orm/libsql";

import { APIError } from "better-auth/api";
import { eq } from "drizzle-orm";

import { getAssuranceForOAuth } from "@/lib/assurance/data";
import { findSatisfiedAcr } from "@/lib/auth/oidc/step-up";
import { cibaRequests } from "@/lib/db/schema/ciba";

/**
 * Check acr_values before approving a CIBA request.
 * Called from the before hook on /ciba/authorize.
 */
export async function enforceCibaApprovalAcr(
  // biome-ignore lint/suspicious/noExplicitAny: middleware context is untyped
  ctx: any,
  // biome-ignore lint/suspicious/noExplicitAny: drizzle schema generic
  db: LibSQLDatabase<any>
) {
  const authReqId =
    typeof ctx.body?.auth_req_id === "string"
      ? ctx.body.auth_req_id
      : undefined;
  if (!authReqId) {
    return;
  }

  const record = await db
    .select({ acrValues: cibaRequests.acrValues, userId: cibaRequests.userId })
    .from(cibaRequests)
    .where(eq(cibaRequests.authReqId, authReqId))
    .limit(1)
    .get();

  if (!record?.acrValues) {
    return;
  }

  const assurance = await getAssuranceForOAuth(record.userId);
  const satisfied = findSatisfiedAcr(record.acrValues, assurance.tier);

  if (!satisfied) {
    throw new APIError("FORBIDDEN", {
      message: `Your assurance level (tier-${assurance.tier}) does not meet the required level: ${record.acrValues}`,
    });
  }
}

/**
 * Safety net: re-check acr_values at CIBA token exchange time.
 * Called from the before hook on /oauth2/token when grant_type is CIBA.
 */
export async function enforceCibaTokenAcr(
  // biome-ignore lint/suspicious/noExplicitAny: middleware context is untyped
  ctx: any,
  // biome-ignore lint/suspicious/noExplicitAny: drizzle schema generic
  db: LibSQLDatabase<any>
) {
  const authReqId =
    typeof ctx.body?.auth_req_id === "string"
      ? ctx.body.auth_req_id
      : undefined;
  if (!authReqId) {
    return;
  }

  const record = await db
    .select({
      acrValues: cibaRequests.acrValues,
      userId: cibaRequests.userId,
      status: cibaRequests.status,
    })
    .from(cibaRequests)
    .where(eq(cibaRequests.authReqId, authReqId))
    .limit(1)
    .get();

  if (!record?.acrValues || record.status !== "approved") {
    return;
  }

  const assurance = await getAssuranceForOAuth(record.userId);
  const satisfied = findSatisfiedAcr(record.acrValues, assurance.tier);

  if (!satisfied) {
    throw new APIError("BAD_REQUEST", {
      error: "interaction_required",
      error_description: `User assurance is tier-${assurance.tier}, does not satisfy acr_values: ${record.acrValues}`,
    });
  }
}
