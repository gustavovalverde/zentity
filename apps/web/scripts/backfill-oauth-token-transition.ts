#!/usr/bin/env tsx

/**
 * One-time transition for the move to the OAuth provider's JWT revocation,
 * per-token `accessTokenClaims`, and the first-party-apps plugin. Every step
 * is idempotent, and the script applies them in one transaction.
 *
 * 1. Moves the timestamp defaults that #298 and #338 changed from
 *    `datetime('now')` to an ISO 8601 timestamp, and recreates the two partial
 *    unique indexes on `humanity_credentials`. drizzle-kit 0.31 changes a
 *    libsql column default by dropping and recreating every index in the
 *    database, and it also recreates partial indexes on every push. After it
 *    removes duplicate statements, the two passes over those partial indexes
 *    either drop one twice, which fails the push with "no such index", or drop
 *    one without recreating it. With the defaults already moved, `pnpm db:push`
 *    alters no column and recreates the partial indexes once, in its own
 *    transaction.
 * 2. Adds `oauth_access_token.auth_context_id` with the DDL `pnpm db:push`
 *    would emit, where an earlier `pnpm db:push` (#321) dropped it. drizzle
 *    names every schema column in an insert, so until the column exists the
 *    new release cannot store an access token.
 * 3. Creates `first_party_auth_session` and `first_party_failure_budget` with
 *    the DDL `pnpm db:push` would emit, so the Authorization Challenge Endpoint
 *    and the CIBA token step-up work as soon as the new release serves traffic.
 * 4. Marks every JWT access token in `revoked_token` that may still be
 *    unexpired as revoked in the provider's verification store. Earlier
 *    releases recorded JWT revocations only in `revoked_token`, which no check
 *    reads any more, so without a marker such a token is accepted until `exp`.
 * 5. Copies Zentity's `exchange_claims` into `access_token_claims` for opaque
 *    exchanged tokens, so chained exchanges keep the parent's delegation depth
 *    and agent claims, and bootstrap tokens keep `zentity_token_use`. Skipped
 *    once `pnpm db:push` has dropped the column.
 * 6. Decodes `access_token_claims` rows written while drizzle's json mode
 *    encoded the adapter's JSON a second time.
 *
 * Rollout order:
 *
 *   a. Run this script.
 *   b. Deploy the web service.
 *   c. Once the new release serves all traffic, run this script again. It
 *      covers revocations and exchanged tokens the previous release wrote
 *      after step a.
 *   d. Run `pnpm db:push` once. It drops `auth_challenge_session`,
 *      `oauth_access_token.exchange_claims`, and the `reason`, `actor_sub`,
 *      and `audience` columns of `revoked_token`, which the previous release
 *      reads or writes, so it must not run before step c. When they hold
 *      rows, it asks to confirm the data loss; `--force` confirms it without
 *      a terminal. drizzle-kit exits 0 even when SQLite rejects a statement
 *      and rolls the push back, so check its output for an error.
 *
 * Because step a creates the new tables and columns and moves the defaults,
 * `pnpm db:push` asks no rename questions and needs no second run. The previous
 * release already writes ISO timestamps to these columns next to
 * `datetime('now')` ones, so step a changes only the format of the rows it
 * leaves to a default. In-flight `auth_challenge_session` handles (10-minute
 * lifetime) stop working at step b.
 *
 *   TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... pnpm exec tsx scripts/backfill-oauth-token-transition.ts
 */

import { createClient, type InStatement } from "@libsql/client";

// `accessTokenExpiresIn` in auth-config.ts. A revoked JWT was unexpired when
// it was revoked, so it expires within this long of `revoked_at`; one more
// second matches the provider's own marker margin.
const MARKER_LIFETIME_MS = (3600 + 1) * 1000;

// The columns whose default #298 or #338 moved, all `text NOT NULL`, and the
// default `drizzle-kit export` gives them.
const ISO_TIMESTAMP_DEFAULT = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
const ISO_TIMESTAMP_COLUMNS: Record<string, readonly string[]> = {
  attestation_evidence: ["created_at", "updated_at"],
  blockchain_attestations: ["created_at", "updated_at"],
  credential_binding_commitments: ["created_at"],
  encrypted_attributes: ["created_at"],
  encrypted_secrets: ["created_at", "updated_at"],
  humanity_challenges: ["created_at"],
  humanity_credentials: ["attached_at", "created_at", "updated_at"],
  identity_bundles: ["created_at", "updated_at"],
  identity_validity_deliveries: ["available_at", "created_at", "updated_at"],
  identity_validity_events: ["created_at"],
  identity_validity_source_cursors: ["created_at", "updated_at"],
  identity_verification_drafts: ["created_at", "updated_at"],
  identity_verification_jobs: ["created_at", "updated_at"],
  identity_verifications: ["created_at", "updated_at"],
  invitation: ["createdAt"],
  member: ["createdAt"],
  organization: ["createdAt"],
  proof_artifacts: ["created_at"],
  secret_wrappers: ["created_at", "updated_at"],
  signed_claims: ["created_at"],
  verification_checks: ["created_at", "updated_at"],
  wallet_address: ["created_at"],
};

// `drizzle-kit export` output for the partial unique indexes in identity.ts.
// Dropping and creating each in the script's transaction restores one an
// earlier push left missing, and no other connection sees it absent.
const HUMANITY_CREDENTIAL_UNIQUE_INDEXES = [
  "DROP INDEX IF EXISTS `humanity_credentials_active_subject_unique`",
  "CREATE UNIQUE INDEX `humanity_credentials_active_subject_unique` ON `humanity_credentials` (`provider`,`provider_subject_hash`) WHERE revoked_at is null",
  "DROP INDEX IF EXISTS `humanity_credentials_active_user_provider_unique`",
  "CREATE UNIQUE INDEX `humanity_credentials_active_user_provider_unique` ON `humanity_credentials` (`user_id`,`provider`) WHERE revoked_at is null",
];

// `drizzle-kit export` output for these two tables in oauth-provider.ts, with
// IF NOT EXISTS added. It must stay identical to that schema, or the later
// `pnpm db:push` rebuilds the tables.
const FIRST_PARTY_APPS_DDL = [
  `CREATE TABLE IF NOT EXISTS \`first_party_auth_session\` (
	\`id\` text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))) NOT NULL,
	\`auth_session\` text NOT NULL,
	\`client_id\` text NOT NULL,
	\`user_id\` text,
	\`session_id\` text,
	\`owns_session\` integer DEFAULT false NOT NULL,
	\`dpop_jkt\` text,
	\`state\` text NOT NULL,
	\`method\` text,
	\`method_state\` text,
	\`request\` text NOT NULL,
	\`ceiling\` text,
	\`amr\` text,
	\`failures\` integer DEFAULT 0 NOT NULL,
	\`attempts\` integer DEFAULT 0 NOT NULL,
	\`expires_at\` integer NOT NULL,
	\`created_at\` integer NOT NULL,
	\`updated_at\` integer NOT NULL,
	FOREIGN KEY (\`client_id\`) REFERENCES \`oauth_client\`(\`client_id\`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (\`user_id\`) REFERENCES \`user\`(\`id\`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON UPDATE no action ON DELETE cascade
)`,
  "CREATE UNIQUE INDEX IF NOT EXISTS `first_party_auth_session_auth_session_unique` ON `first_party_auth_session` (`auth_session`)",
  "CREATE INDEX IF NOT EXISTS `first_party_auth_session_client_id_idx` ON `first_party_auth_session` (`client_id`)",
  "CREATE INDEX IF NOT EXISTS `first_party_auth_session_user_id_idx` ON `first_party_auth_session` (`user_id`)",
  "CREATE INDEX IF NOT EXISTS `first_party_auth_session_session_id_idx` ON `first_party_auth_session` (`session_id`)",
  "CREATE INDEX IF NOT EXISTS `first_party_auth_session_expires_at_idx` ON `first_party_auth_session` (`expires_at`)",
  `CREATE TABLE IF NOT EXISTS \`first_party_failure_budget\` (
	\`id\` text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))) NOT NULL,
	\`key\` text NOT NULL,
	\`failures\` integer NOT NULL,
	\`reset_at\` integer NOT NULL
)`,
  "CREATE UNIQUE INDEX IF NOT EXISTS `first_party_failure_budget_key_unique` ON `first_party_failure_budget` (`key`)",
  "CREATE INDEX IF NOT EXISTS `first_party_failure_budget_reset_at_idx` ON `first_party_failure_budget` (`reset_at`)",
];

// `drizzle-kit push` output for this column in oauth-provider.ts.
const ACCESS_TOKEN_AUTH_CONTEXT_DDL =
  "ALTER TABLE `oauth_access_token` ADD `auth_context_id` text REFERENCES authentication_context(id) ON DELETE set null ON UPDATE no action";

const url = process.env.TURSO_DATABASE_URL || "file:./.data/dev.db";
const authToken = process.env.TURSO_AUTH_TOKEN;
const client = createClient(authToken ? { url, authToken } : { url });

async function hasColumn(table: string, column: string): Promise<boolean> {
  const result = await client.execute({
    sql: "SELECT 1 FROM pragma_table_info(?) WHERE name = ?",
    args: [table, column],
  });
  return result.rows.length > 0;
}

/** The `ALTER COLUMN` statements for the ISO defaults not yet moved. */
async function isoTimestampDefaultStatements(): Promise<string[]> {
  const result = await client.execute(
    `SELECT m.name AS table_name, p.name AS column_name
     FROM sqlite_master m, pragma_table_xinfo(m.name) p
     WHERE m.type = 'table' AND p.dflt_value = 'datetime(''now'')'`
  );
  return result.rows
    .map((row) => ({
      table: String(row.table_name),
      column: String(row.column_name),
    }))
    .filter(({ table, column }) =>
      ISO_TIMESTAMP_COLUMNS[table]?.includes(column)
    )
    .map(
      ({ table, column }) =>
        `ALTER TABLE \`${table}\` ALTER COLUMN "${column}" TO "${column}" text NOT NULL DEFAULT (${ISO_TIMESTAMP_DEFAULT})`
    );
}

async function main(): Promise<void> {
  const now = Date.now();
  const copyExchangeClaims = await hasColumn(
    "oauth_access_token",
    "exchange_claims"
  );

  const addAccessTokenAuthContext = !(await hasColumn(
    "oauth_access_token",
    "auth_context_id"
  ));

  const timestampDefaults = await isoTimestampDefaultStatements();
  const schema = [
    ...timestampDefaults,
    ...HUMANITY_CREDENTIAL_UNIQUE_INDEXES,
    ...(addAccessTokenAuthContext ? [ACCESS_TOKEN_AUTH_CONTEXT_DDL] : []),
    ...FIRST_PARTY_APPS_DDL,
  ];

  const statements: InStatement[] = [
    ...schema.map((sql) => ({ sql, args: [] })),
    {
      // The provider's mark for a revoked JWT access token. Writing it here
      // bypasses the verification hook in token-revocation.ts, which would
      // only record the `jti` that `revoked_token` already holds.
      sql: `INSERT INTO verification (id, identifier, value, expiresAt, createdAt, updatedAt)
        SELECT lower(hex(randomblob(16))),
               'oauth-revoked-access-token:' || rt.jti,
               'revoked_token backfill',
               rt.revoked_at + :lifetime,
               :now,
               :now
        FROM revoked_token rt
        WHERE rt.revoked_at + :lifetime > :now
          AND NOT EXISTS (
            SELECT 1 FROM verification v
            WHERE v.identifier = 'oauth-revoked-access-token:' || rt.jti
          )`,
      args: { lifetime: MARKER_LIFETIME_MS, now },
    },
    {
      sql: `UPDATE oauth_access_token
        SET access_token_claims = json_extract(access_token_claims, '$')
        WHERE CASE WHEN json_valid(access_token_claims)
                   THEN json_type(access_token_claims) = 'text'
                   ELSE 0 END`,
      args: [],
    },
  ];
  if (copyExchangeClaims) {
    statements.push({
      sql: `UPDATE oauth_access_token
        SET access_token_claims = exchange_claims
        WHERE exchange_claims IS NOT NULL
          AND exchange_claims <> '{}'
          AND access_token_claims IS NULL`,
      args: [],
    });
  }

  const results = await client.batch(statements, "write");
  const [markers, decoded, copied] = results.slice(schema.length);
  console.log(`timestamp defaults moved: ${timestampDefaults.length}`);
  console.log(
    `oauth_access_token.auth_context_id: ${addAccessTokenAuthContext ? "added" : "already present"}`
  );
  console.log(`revocation markers added: ${markers?.rowsAffected ?? 0}`);
  console.log(`access_token_claims decoded: ${decoded?.rowsAffected ?? 0}`);
  console.log(
    copyExchangeClaims
      ? `exchange_claims copied: ${copied?.rowsAffected ?? 0}`
      : "exchange_claims copied: skipped (column already dropped)"
  );
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => client.close());
