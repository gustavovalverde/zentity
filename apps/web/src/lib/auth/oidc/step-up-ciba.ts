/**
 * Step-Up Authentication — CIBA acr_values enforcement
 *
 * Enforces acr_values at two points in the CIBA flow:
 * 1. Approval time — prevents user from approving if their tier is insufficient
 * 2. Token exchange — safety net if tier decreased between approval and polling
 *
 * For first-party clients (FPA), the token exchange safety net returns
 * HTTP 403 + auth_session so the client can re-authenticate via the
 * Authorization Challenge Endpoint instead of requiring a browser redirect.
 */

import type { LibSQLDatabase } from "drizzle-orm/libsql";

import { randomBytes } from "node:crypto";

import { APIError } from "better-auth/api";
import { eq } from "drizzle-orm";
import { calculateJwkThumbprint, decodeProtectedHeader } from "jose";

import { getAssuranceForOAuth } from "@/lib/assurance/data";
import { findSatisfiedAcr } from "@/lib/auth/oidc/step-up";
import { authChallengeSessions } from "@/lib/db/schema/auth-challenge";
import { cibaRequests } from "@/lib/db/schema/ciba";
import { oauthClients } from "@/lib/db/schema/oauth-provider";

const SESSION_LIFETIME_MS = 10 * 60 * 1000;

async function extractDpopJkt(
  headers: Headers | undefined
): Promise<string | undefined> {
  const proof = headers?.get("DPoP");
  if (!proof) {
    return undefined;
  }
  try {
    const header = decodeProtectedHeader(proof);
    if (header.jwk) {
      return await calculateJwkThumbprint(
        header.jwk as Record<string, unknown>
      );
    }
  } catch {
    // DPoP proof parsing failed
  }
  return undefined;
}

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
 *
 * For first-party clients: returns 403 + auth_session (FPA step-up path).
 * For other clients: returns 400 interaction_required (standard behavior).
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
      scope: cibaRequests.scope,
      resource: cibaRequests.resource,
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
    const clientId =
      typeof ctx.body?.client_id === "string" ? ctx.body.client_id : undefined;

    if (clientId) {
      const client = await db
        .select({ firstParty: oauthClients.firstParty })
        .from(oauthClients)
        .where(eq(oauthClients.clientId, clientId))
        .get();

      if (client?.firstParty) {
        const authSession = randomBytes(32).toString("base64url");
        const dpopJkt = await extractDpopJkt(ctx.headers);

        await db.insert(authChallengeSessions).values({
          authSession,
          clientId,
          userId: record.userId,
          scope: record.scope,
          resource: record.resource ?? null,
          acrValues: record.acrValues,
          dpopJkt: dpopJkt ?? null,
          state: "pending",
          expiresAt: new Date(Date.now() + SESSION_LIFETIME_MS),
        });

        throw new APIError("FORBIDDEN", {
          error: "insufficient_authorization",
          auth_session: authSession,
          error_description: `User assurance is tier-${assurance.tier}, does not satisfy acr_values: ${record.acrValues}`,
        });
      }
    }

    throw new APIError("BAD_REQUEST", {
      error: "interaction_required",
      error_description: `User assurance is tier-${assurance.tier}, does not satisfy acr_values: ${record.acrValues}`,
    });
  }
}
