#!/usr/bin/env tsx

/**
 * One-time transition for the move to the OAuth provider's JWT revocation.
 * Every step is idempotent, and the script applies them in one transaction.
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
 * 2. Marks every JWT access token in `revoked_token` that may still be
 *    unexpired as revoked in the provider's verification store. Earlier
 *    releases recorded JWT revocations only in `revoked_token`, which no check
 *    reads any more, so without a marker such a token is accepted until `exp`.
 *
 * Rollout order:
 *
 *   a. Run this script.
 *   b. Deploy the web service.
 *   c. Once the new release serves all traffic, run this script again. It
 *      covers revocations the previous release wrote after step a.
 *   d. Run `pnpm db:push` once. It drops the `reason`, `actor_sub`, and
 *      `audience` columns of `revoked_token`, which the previous release
 *      writes, so it must not run before step c. When they hold rows, it asks
 *      to confirm the data loss; `--force` confirms it without a terminal.
 *
 * Because step a moves the defaults, `pnpm db:push` needs no second run. The
 * previous release already writes ISO timestamps to these columns next to
 * `datetime('now')` ones, so step a changes only the format of the rows it
 * leaves to a default.
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

const url = process.env.TURSO_DATABASE_URL || "file:./.data/dev.db";
const authToken = process.env.TURSO_AUTH_TOKEN;
const client = createClient(authToken ? { url, authToken } : { url });

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

  const timestampDefaults = await isoTimestampDefaultStatements();
  const schema = [...timestampDefaults, ...HUMANITY_CREDENTIAL_UNIQUE_INDEXES];

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
  ];

  const results = await client.batch(statements, "write");
  const [markers] = results.slice(schema.length);
  console.log(`timestamp defaults moved: ${timestampDefaults.length}`);
  console.log(`revocation markers added: ${markers?.rowsAffected ?? 0}`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => client.close());
