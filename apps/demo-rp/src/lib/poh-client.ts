import "server-only";

import { and, eq } from "drizzle-orm";
import { calculateJwkThumbprint, decodeJwt } from "jose";
import { headers } from "next/headers";

import { getAuth } from "@/lib/auth";
import { getDb } from "@/lib/db/connection";
import { account, oauthDpopKey } from "@/lib/db/schema";
import { createPersistentDpopClient } from "@/lib/dpop";
import { env } from "@/lib/env";
import { parseOAuthJsonResponse } from "@/lib/oauth-response";

export interface PohResult {
  claims: {
    method: string | null;
    sybil_resistant: boolean;
    tier: number;
    verified: boolean;
  };
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

  const dpop = await createPersistentDpopClient({
    publicJwk: JSON.parse(dpopRow.publicJwk),
    privateJwk: JSON.parse(dpopRow.privateJwk),
  });

  const pohUrl = `${env.ZENTITY_URL}/api/auth/oauth2/proof-of-human`;
  const token = acct.accessToken;

  const { response, result } = await dpop.withNonceRetry(async (nonce) => {
    const proof = await dpop.proofFor("POST", pohUrl, token, nonce);
    const res = await fetch(pohUrl, {
      method: "POST",
      headers: {
        Authorization: `DPoP ${token}`,
        DPoP: proof,
      },
    });
    const needsNonceRetry =
      (res.status === 400 || res.status === 401) &&
      Boolean(res.headers.get("DPoP-Nonce"));
    return {
      response: res,
      result: needsNonceRetry
        ? {}
        : await parseOAuthJsonResponse(res, "PoH request"),
    };
  });

  if (!response.ok) {
    return {
      error:
        ((result as Record<string, unknown>).error as string) ?? "poh_failed",
      error_description:
        ((result as Record<string, unknown>).error_description as string) ??
        `Zentity returned ${response.status}`,
      status: response.status,
    };
  }

  const pohToken = (result as Record<string, unknown>).token as
    | string
    | undefined;
  if (!pohToken) {
    return { error: "no_token_in_response", status: 502 };
  }

  const jwt = decodeJwt(pohToken);
  const poh = jwt.poh as Record<string, unknown> | undefined;
  const cnf = jwt.cnf as { jkt?: string } | undefined;

  return {
    token: pohToken,
    dpopJkt: cnf?.jkt ?? null,
    claims: {
      tier: (poh?.tier as number) ?? 0,
      verified: Boolean(poh?.verified),
      sybil_resistant: Boolean(poh?.sybil_resistant),
      method: (poh?.method as string) ?? null,
    },
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
