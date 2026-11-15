import "server-only";

import type { Verification } from "better-auth";

import { db } from "@/lib/db/connection";
import { revokedTokens } from "@/lib/db/schema/revoked-tokens";

/**
 * The revocation feed of the wallet runtime (`/api/auth/oauth2/revoked`).
 *
 * The OAuth provider revokes JWT access tokens (`revocableJwtAccessTokens`):
 * `/oauth2/revoke` authenticates the client, checks the token's signature and
 * owner, and stores a mark for its `jti` that introspection, UserInfo, and
 * `validateAccessToken` consult. The mark lasts only until the token's `exp`.
 * The wallet runtime verifies payment tokens itself and accepts them for a
 * clock-skew leeway past `exp`, so the feed keeps a durable record of every
 * revoked `jti` in `revoked_token`.
 */

// The identifier of the provider's mark. The provider does not export it; the
// revocation integration tests fail if it changes.
const REVOKED_ACCESS_TOKEN_PREFIX = "oauth-revoked-access-token:";

/**
 * A `verification.create.before` hook. It records the `jti` before the
 * provider stores its mark, so a failed write leaves the token revoked nowhere
 * and the client's retry of the revocation records both.
 */
export async function recordRevokedAccessToken(
  verification: Pick<Verification, "identifier">
): Promise<void> {
  if (!verification.identifier.startsWith(REVOKED_ACCESS_TOKEN_PREFIX)) {
    return;
  }
  await db
    .insert(revokedTokens)
    .values({
      jti: verification.identifier.slice(REVOKED_ACCESS_TOKEN_PREFIX.length),
    })
    .onConflictDoNothing({ target: revokedTokens.jti });
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
}): Promise<{ revokedAt: Date; jti: string }[]> {
  const since = new Date(input.sinceUnixMs);
  const rows = await db.query.revokedTokens.findMany({
    where: (table, { gt }) => gt(table.revokedAt, since),
    orderBy: (table, { asc }) => [asc(table.revokedAt), asc(table.jti)],
    limit: input.limit,
  });
  return rows.map((row) => ({ revokedAt: row.revokedAt, jti: row.jti }));
}
