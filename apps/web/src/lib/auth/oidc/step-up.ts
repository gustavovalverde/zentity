/**
 * Step-Up Authentication for non-browser grants.
 *
 * Better Auth's OAuth Provider owns browser authorization `acr_values` and
 * `max_age`. This module retains the Zentity tier ordering shared with that
 * provider callback and the CIBA/FPA approval and token-exchange safety nets.
 *
 * For first-party clients (FPA), the CIBA token exchange safety net returns
 * HTTP 403 + auth_session so the client can re-authenticate via the
 * Authorization Challenge Endpoint instead of requiring a browser redirect.
 */
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import type { AccountTier } from "@/lib/assurance/types";

import { randomBytes } from "node:crypto";

import { APIError } from "better-auth/api";
import { eq } from "drizzle-orm";
import { calculateJwkThumbprint, decodeProtectedHeader } from "jose";

import { getAccountAssurance } from "@/lib/assurance/posture";
import { hashCibaAuthReqId } from "@/lib/auth/oidc/ciba-auth-req";
import { cibaRequests } from "@/lib/db/schema/ciba";
import {
  authChallengeSessions,
  oauthClients,
} from "@/lib/db/schema/oauth-provider";

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

const ACR_TIER_PATTERN = /^urn:zentity:assurance:tier-(\d)$/;
const WHITESPACE = /\s+/;
const SESSION_LIFETIME_MS = 10 * 60 * 1000;

function parseAcrValues(raw: string): string[] {
  return raw.split(WHITESPACE).filter(Boolean);
}

function extractTierFromAcr(acr: string): number | null {
  const match = ACR_TIER_PATTERN.exec(acr);
  return match?.[1] ? Number.parseInt(match[1], 10) : null;
}

/**
 * Find the first requested ACR that the user's tier satisfies.
 * Higher tiers satisfy lower requirements (tier-3 satisfies tier-2).
 * Returns the first satisfiable ACR URI, or null if none are satisfied.
 */
export function findSatisfiedAcr(
  acrValuesParam: string,
  userTier: AccountTier
): string | null {
  const requested = parseAcrValues(acrValuesParam);
  for (const acr of requested) {
    const requestedTier = extractTierFromAcr(acr);
    if (requestedTier !== null && userTier >= requestedTier) {
      return acr;
    }
  }
  return null;
}

/** Whether a resolved Zentity ACR satisfies any requested assurance class. */
export function authenticationContextSatisfies(
  acr: string,
  requestedAcrValues: string[]
): boolean {
  const tier = extractTierFromAcr(acr);
  return (
    tier !== null &&
    requestedAcrValues.some((requested) => {
      const requestedTier = extractTierFromAcr(requested);
      return requestedTier !== null && tier >= requestedTier;
    })
  );
}

// ---------------------------------------------------------------------------
// CIBA enforcement
// ---------------------------------------------------------------------------

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
    .where(eq(cibaRequests.authReqId, hashCibaAuthReqId(authReqId)))
    .limit(1)
    .get();

  if (!record?.acrValues) {
    return;
  }

  const assurance = await getAccountAssurance(record.userId, {
    isAuthenticated: true,
  });
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
    .where(eq(cibaRequests.authReqId, hashCibaAuthReqId(authReqId)))
    .limit(1)
    .get();

  if (!record?.acrValues || record.status !== "approved") {
    return;
  }

  const assurance = await getAccountAssurance(record.userId, {
    isAuthenticated: true,
  });
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
