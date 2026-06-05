/**
 * `revoked_tokens` table for OAuth token revocation propagation.
 *
 * The RFC 7009 `/oauth2/revoke` endpoint writes a row here for every
 * revoked `jti`; the delta endpoint at `/api/auth/oauth2/revoked?since=` reads
 * from it to feed the wallet runtime's revocation poller (Proposal-0003 D-6).
 *
 * Rows are append-only: revocation is monotonic; a revoked token never
 * becomes valid again. A periodic cleanup job past `exp + grace` removes
 * entries the issuer is certain no consumer still polls.
 */

import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const revokedTokens = sqliteTable(
  "revoked_token",
  {
    /**
     * Token identifier (`jti` claim). Acts as the primary key: a revocation
     * is idempotent on the token id.
     */
    jti: text("jti").primaryKey(),
    /**
     * Unix-epoch milliseconds at which the issuer recorded the revocation.
     * The wallet runtime's delta poller queries `revoked_at > since` to fetch
     * new revocations since the last poll.
     */
    revokedAt: integer("revoked_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    /**
     * RFC 7009 hint or operator-supplied reason. Free-form; never feeds into
     * security decisions (the cache uses presence-in-set semantics).
     */
    reason: text("reason"),
    /**
     * Authoritative actor subject (`act.sub`) of the token being revoked, when
     * the token is an agent-issued one. Captured so the dashboard can
     * present revocations grouped by agent.
     */
    actorSub: text("actor_sub"),
    /**
     * `aud` claim of the revoked token (the wallet JKT in v1). Captured so a
     * dashboard query can list revocations by destination wallet.
     */
    audience: text("audience"),
  },
  (table) => [
    index("revoked_token_revoked_at_idx").on(table.revokedAt),
    index("revoked_token_actor_sub_idx").on(table.actorSub),
  ]
);
