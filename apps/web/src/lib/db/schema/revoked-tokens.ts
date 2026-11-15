/**
 * `revoked_token`: the durable record of revoked JWT access tokens that feeds
 * the wallet runtime's revocation poller (Proposal-0003 D-6) through
 * `/api/auth/oauth2/revoked?since=`.
 *
 * The OAuth provider's own revocation mark expires with the token, so this
 * table keeps every revoked `jti`. Rows are append-only: revocation is
 * monotonic, and a revoked token never becomes valid again.
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
  },
  (table) => [index("revoked_token_revoked_at_idx").on(table.revokedAt)]
);
