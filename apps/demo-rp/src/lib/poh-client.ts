import "server-only";

import {
  type ProofOfHumanClaims,
  requestProofOfHumanToken,
} from "@zentity/sdk/rp";
import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";

import { getAuth } from "@/lib/auth";
import { getDb } from "@/lib/db/connection";
import { account } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { getOAuthDpopClient, getOAuthDpopJkt } from "@/lib/oauth-dpop-client";
import { getOAuthProviderId } from "@/scenarios/route-scenario-registry";

const X402_OAUTH_PROVIDER_ID = getOAuthProviderId("x402");

export interface PohResult {
  claims: ProofOfHumanClaims;
  dpopJkt: string | null;
  token: string;
}

export interface PohError {
  error: string;
  error_description?: string;
  status: number;
}

/**
 * Acquires a PoH token from Zentity using the current user's stored
 * DPoP-bound access token. Returns the token, decoded claims, and the
 * DPoP JKT (so the caller can verify proof-of-possession).
 */
export async function acquirePohToken(): Promise<PohResult | PohError> {
  const auth = await getAuth();
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session?.user?.id) {
    return { error: "not_authenticated", status: 401 };
  }

  const acct = await getDb()
    .select({
      accessToken: account.accessToken,
      accessTokenExpiresAt: account.accessTokenExpiresAt,
    })
    .from(account)
    .where(
      and(
        eq(account.userId, session.user.id),
        eq(account.providerId, X402_OAUTH_PROVIDER_ID)
      )
    )
    .limit(1)
    .get();

  if (!acct?.accessToken) {
    return {
      error: "no_access_token",
      error_description: "Sign in first",
      status: 401,
    };
  }

  if (acct.accessTokenExpiresAt) {
    const expiry = new Date(acct.accessTokenExpiresAt).getTime();
    if (expiry < Date.now()) {
      return { error: "token_expired", status: 401 };
    }
  }

  const result = await requestProofOfHumanToken({
    accessToken: acct.accessToken,
    dpopClient: await getOAuthDpopClient(),
    proofOfHumanUrl: `${env.ZENTITY_URL}/api/auth/oauth2/proof-of-human`,
  });

  if (!result.ok) {
    return {
      error: result.error,
      status: result.status,
      ...(result.errorDescription
        ? { error_description: result.errorDescription }
        : {}),
    };
  }

  return {
    token: result.token,
    dpopJkt: result.confirmationJkt,
    claims: result.unverifiedClaims,
  };
}

export function isPohError(r: PohResult | PohError): r is PohError {
  return "status" in r;
}

/**
 * What a PoH token presented by the signed-in user must be bound to: the
 * subject Zentity issued to the x402 client for this user, and the sign-in
 * DPoP key's thumbprint. Every demo-rp user shares that key, so the subject
 * is what ties the token to this user rather than to any user of this
 * deployment. Null without a session or an x402 access token.
 */
export async function getProofOfHumanBinding(): Promise<{
  jkt: string;
  subject: string;
} | null> {
  const auth = await getAuth();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) {
    return null;
  }

  const acct = await getDb()
    .select({ accessToken: account.accessToken, accountId: account.accountId })
    .from(account)
    .where(
      and(
        eq(account.userId, session.user.id),
        eq(account.providerId, X402_OAUTH_PROVIDER_ID)
      )
    )
    .limit(1)
    .get();
  if (!(acct?.accessToken && acct.accountId)) {
    return null;
  }

  return { jkt: await getOAuthDpopJkt(), subject: acct.accountId };
}
