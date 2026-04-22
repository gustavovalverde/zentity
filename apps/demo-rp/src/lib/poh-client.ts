import "server-only";

import {
  createDpopClientFromKeyPair,
  type ProofOfHumanClaims,
  requestProofOfHumanToken,
} from "@zentity/sdk/rp";
import { and, eq } from "drizzle-orm";
import { calculateJwkThumbprint } from "jose";
import { headers } from "next/headers";

import { getAuth } from "@/lib/auth";
import { getDb } from "@/lib/db/connection";
import { account, oauthDpopKey } from "@/lib/db/schema";
import { env } from "@/lib/env";

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
        eq(account.providerId, "zentity-x402")
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

  const dpopRow = await getDb()
    .select({
      publicJwk: oauthDpopKey.publicJwk,
      privateJwk: oauthDpopKey.privateJwk,
    })
    .from(oauthDpopKey)
    .where(eq(oauthDpopKey.accessToken, acct.accessToken))
    .limit(1)
    .get();

  if (!dpopRow) {
    return { error: "dpop_keys_missing", status: 500 };
  }

  const dpop = await createDpopClientFromKeyPair({
    publicJwk: JSON.parse(dpopRow.publicJwk),
    privateJwk: JSON.parse(dpopRow.privateJwk),
  });

  const result = await requestProofOfHumanToken({
    accessToken: acct.accessToken,
    dpopClient: dpop,
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
 * Returns the JWK thumbprint of the DPoP key stored for the x402 provider.
 * Used to verify that a PoH token's cnf.jkt was bound to OUR key.
 */
export async function getStoredDpopJkt(): Promise<string | null> {
  const auth = await getAuth();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) {
    return null;
  }

  const acct = await getDb()
    .select({ accessToken: account.accessToken })
    .from(account)
    .where(
      and(
        eq(account.userId, session.user.id),
        eq(account.providerId, "zentity-x402")
      )
    )
    .limit(1)
    .get();
  if (!acct?.accessToken) {
    return null;
  }

  const dpopRow = await getDb()
    .select({ publicJwk: oauthDpopKey.publicJwk })
    .from(oauthDpopKey)
    .where(eq(oauthDpopKey.accessToken, acct.accessToken))
    .limit(1)
    .get();
  if (!dpopRow) {
    return null;
  }

  return calculateJwkThumbprint(JSON.parse(dpopRow.publicJwk));
}
