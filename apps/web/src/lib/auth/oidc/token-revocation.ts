import "server-only";

import { eq } from "drizzle-orm";
import { decodeJwt } from "jose";

import { db } from "@/lib/db/connection";
import { oauthAccessTokens } from "@/lib/db/schema/oauth-provider";
import { revokedTokens } from "@/lib/db/schema/revoked-tokens";

/**
 * RFC 7009 token revocation backend.
 *
 * Looks up the supplied `token` in the OAuth access-token store, extracts the
 * `jti`, and writes a `revoked_token` row keyed on that id. The wallet
 * runtime's revocation poller (Proposal-0003 D-6) queries this table via the
 * delta endpoint at `/api/auth/oauth2/revoked?since=` and fails closed when
 * its cache outruns the issuer.
 *
 * Idempotent: revoking an already-revoked token returns `{ revoked: true }`
 * without writing a duplicate row.
 *
 * The function deliberately accepts both opaque tokens (stored in
 * `oauth_access_token.token`) and `at+jwt` (decoded directly for the `jti`),
 * so RFC 7009 callers can pass whichever form they hold.
 */

export interface RevokeTokenInput {
  /** Free-form operator-supplied reason; recorded verbatim. */
  reason?: string;
  /** Either the opaque token string or a serialized `at+jwt`. */
  token: string;
  /** RFC 7009 `token_type_hint`. Optional. */
  tokenTypeHint?: "access_token" | "refresh_token";
}

export interface RevokeTokenOutput {
  /** The `jti` that was revoked, when known. */
  jti?: string;
  /** True when the token's `jti` is now in the revocation set. */
  revoked: boolean;
  /** True when the token was unknown to the issuer (RFC 7009 returns 200 anyway). */
  unknown: boolean;
}

const JWT_PREFIX = "eyJ";

/**
 * Revokes `token` if the issuer recognises it. RFC 7009 §2.2 specifies that
 * an unknown token returns success without surfacing the existence question
 * to the caller; this implementation honours that by returning
 * `{ revoked: false, unknown: true }` and letting the route serialize
 * 200 OK regardless.
 */
export async function revokeToken(
  input: RevokeTokenInput
): Promise<RevokeTokenOutput> {
  const jti = await resolveJti(input.token);
  if (!jti) {
    return { revoked: false, unknown: true };
  }

  await db
    .insert(revokedTokens)
    .values({
      jti,
      reason: input.reason ?? input.tokenTypeHint ?? null,
    })
    .onConflictDoNothing({ target: revokedTokens.jti });

  return { revoked: true, jti, unknown: false };
}

async function resolveJti(token: string): Promise<string | undefined> {
  if (token.startsWith(JWT_PREFIX)) {
    try {
      const claims = decodeJwt(token);
      const jti = claims.jti;
      return typeof jti === "string" ? jti : undefined;
    } catch {
      return undefined;
    }
  }

  const [row] = await db
    .select({ referenceId: oauthAccessTokens.referenceId })
    .from(oauthAccessTokens)
    .where(eq(oauthAccessTokens.token, token))
    .limit(1);

  const jti = row?.referenceId;
  return typeof jti === "string" && jti.length > 0 ? jti : undefined;
}

/**
 * Returns every `jti` revoked strictly after `sinceUnixMs`. Drives the wallet
 * runtime's delta poller. Bounded by `limit` to keep an attacker who is
 * spamming revocations from blowing up a poll cycle's response size; the
 * poller follows the next `since` cursor in the response on the next call.
 */
export async function listRevocationsSince(input: {
  sinceUnixMs: number;
  limit: number;
}): Promise<
  {
    revokedAt: Date;
    jti: string;
    reason: string | null;
  }[]
> {
  const since = new Date(input.sinceUnixMs);
  const rows = await db.query.revokedTokens.findMany({
    where: (table, { gt }) => gt(table.revokedAt, since),
    orderBy: (table, { asc }) => [asc(table.revokedAt), asc(table.jti)],
    limit: input.limit,
  });
  return rows.map((row) => ({
    revokedAt: row.revokedAt,
    jti: row.jti,
    reason: row.reason,
  }));
}
