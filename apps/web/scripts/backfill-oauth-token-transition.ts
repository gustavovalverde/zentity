#!/usr/bin/env tsx

/**
 * One-time transition for the move to the OAuth provider's JWT revocation,
 * per-token `accessTokenClaims`, the first-party-apps plugin, the CIBA
 * approval record, its token and Proof-of-Human columns, and OIDC4VCI
 * credentials without a subject. Every step is idempotent, and the script
 * applies them in one transaction.
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
 *    exchanged tokens issued before the deploy, so bootstrap tokens keep
 *    `zentity_token_use` and the provider's introspection keeps returning
 *    their stored claims until they expire. Skipped once `pnpm db:push` has
 *    dropped the column.
 * 6. Decodes `access_token_claims` rows written while drizzle's json mode
 *    encoded the adapter's JSON a second time.
 * 7. Adds `agent_capability.grantable` with the DDL `pnpm db:push` would emit.
 *    drizzle-kit 0.31 reads the column's `false` default as no default and
 *    empties `agent_capability` before it adds a not-null column, which would
 *    cascade into every host policy and session grant. The previous release
 *    never writes the column, so its default serves those rows.
 * 8. Creates `ciba_approval` with the DDL `pnpm db:push` would emit. The new
 *    release records every CIBA decision there and reads it at every CIBA
 *    token poll, so it must exist before that release serves traffic.
 * 9. Stores a pairwise sector on every `oauth_client` row. Earlier releases
 *    cleared the sector the provider stored at registration, so pairwise
 *    subjects followed the first redirect host; the provider and Zentity now
 *    both read the stored sector. A client registered from a metadata document
 *    gets `client/<client_id>`, replacing any other sector, because its
 *    redirect URIs are not bound to the origin that serves the document. Any
 *    other row without a sector gets the provider's rule: the first redirect
 *    host when every redirect URI is https, else `client/<client_id>`.
 *    Subjects of loopback, custom-scheme, and metadata-document clients
 *    change, so their users sign in again.
 * 10. Adds the `token_jti`, `token_audience`, `token_issued_at`,
 *    `poh_minted_at`, and `poh_jti` columns of `ciba_approval`, and the
 *    unique index on `token_jti`, with the DDL `pnpm db:push` would emit. The
 *    new release records every CIBA token on its approval, finds agent tokens
 *    there at introspection, and marks an x402 approval's one Proof-of-Human
 *    mint there.
 * 11. Deletes the `pairwise_subject` rows of type `agent_session`. Agent
 *    actor subjects are no longer indexed, and the schema no longer allows
 *    the type.
 * 12. Lets `oidc4vci_issued_credential.credential` be null. The new release
 *    records issued credentials without the SD-JWT, and the previous release
 *    writes it until step e drops the column.
 * 13. Creates the unique index on the status list entry of
 *    `oidc4vci_issued_credential` with the DDL `pnpm db:push` would emit. The
 *    new release draws status list indices at random and relies on it to keep
 *    two credentials off one entry. While both releases serve, an index the
 *    new release draws can make a credential request of the previous release
 *    fail once.
 * 14. Revokes, through the status list, every credential a previous release
 *    issued: those rows store the SD-JWT, and those credentials carry the
 *    user id as `sub`. Users request a new credential from the dashboard.
 *    Skipped once `pnpm db:push` has dropped the column.
 *
 * Rollout order. Production moves to this release in one deploy of the web
 * service, the MCP server, and demo-rp. Merging a pull request deploys
 * nothing, and no earlier commit of this release may be deployed on its own:
 * earlier commits refuse MCP purchases at bc-authorize, and some read the
 * authentication context of a sessionless opaque token from a claim instead
 * of `oauth_access_token.auth_context_id`. Each such switch costs the tokens
 * issued in the hour before it their authentication context.
 *
 *   a. Run this script.
 *   b. Prepare the other services:
 *      - Set `skip_consent` on every first-party client that keeps using the
 *        Authorization Challenge Endpoint.
 *      - Set `OAUTH_DPOP_KEY_SEED` (min 32 characters, different from
 *        `ZPAY_DPOP_KEY_SEED`) in the demo-rp Vercel project.
 *      - Run `pnpm mcp:provision` with the web service's environment
 *        (`railway run --service web`), and set the `MCP_CLIENT_ID` and
 *        `MCP_CLIENT_SECRET` it prints on the MCP HTTP host. The HTTP
 *        transport refuses to start without them.
 *      - Run `pnpm db:push` against the demo-rp database, which adds
 *        `presentation_replay` and drops `oauth_dpop_key`. The previous
 *        demo-rp reads `oauth_dpop_key`, so its sign-in fails until the new
 *        demo-rp serves, and signed-in demo-rp users sign in again.
 *   c. Deploy the web service, the MCP server, and demo-rp together. The web
 *      service, the SDK, and the MCP server compute the Agent-Assertion task
 *      hash the same way only within one release.
 *   d. Once the new release serves all traffic, run this script again. It
 *      covers revocations and exchanged tokens the previous release wrote
 *      after step a.
 *   e. Run `pnpm db:push` once. It drops `auth_challenge_session`,
 *      `oauth_access_token.exchange_claims`, the `reason`, `actor_sub`, and
 *      `audience` columns of `revoked_token`, the approval columns and
 *      `pairwise_act_sub` of `ciba_request`, `agent_token_snapshot`,
 *      `oidc4vci_issued_credential.credential`, and `oidc4vci_status_list`,
 *      which the previous release reads or writes, so it must not run before
 *      step d. When they hold rows, it asks to confirm the data loss;
 *      `--force` confirms it without a terminal. drizzle-kit exits 0 even
 *      when SQLite rejects a statement and rolls the push back, so check its
 *      output for an error.
 *
 * Because step a creates the new tables and columns and moves the defaults,
 * `pnpm db:push` asks no rename questions and needs no second run. The previous
 * release already writes ISO timestamps to these columns next to
 * `datetime('now')` ones, so step a changes only the format of the rows it
 * leaves to a default. In-flight `auth_challenge_session` handles (10-minute
 * lifetime) stop working at step c.
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

// `drizzle-kit export` output for `ciba_approval` in ciba.ts, with IF NOT
// EXISTS added. It must stay identical to that schema, or the later
// `pnpm db:push` rebuilds the table.
const CIBA_APPROVAL_DDL = [
  `CREATE TABLE IF NOT EXISTS \`ciba_approval\` (
	\`id\` text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))) NOT NULL,
	\`reference_id\` text NOT NULL,
	\`request_id\` text NOT NULL,
	\`user_id\` text NOT NULL,
	\`client_id\` text NOT NULL,
	\`scope\` text NOT NULL,
	\`binding_message\` text,
	\`authorization_details\` text,
	\`acr_values\` text,
	\`decision\` text NOT NULL,
	\`approval_method\` text,
	\`approval_channel\` text NOT NULL,
	\`capability\` text,
	\`grant_id\` text,
	\`host_policy_id\` text,
	\`constraints\` text,
	\`agent_session_id\` text,
	\`host_id\` text,
	\`attestation_tier\` text,
	\`attestation_provider\` text,
	\`auth_context_id\` text,
	\`requested_at\` integer NOT NULL,
	\`decided_at\` integer NOT NULL,
	\`expires_at\` integer NOT NULL,
	\`token_jti\` text,
	\`token_audience\` text,
	\`token_issued_at\` integer,
	\`poh_minted_at\` integer,
	\`poh_jti\` text,
	FOREIGN KEY (\`user_id\`) REFERENCES \`user\`(\`id\`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (\`agent_session_id\`) REFERENCES \`agent_session\`(\`id\`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (\`host_id\`) REFERENCES \`agent_host\`(\`id\`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (\`auth_context_id\`) REFERENCES \`authentication_context\`(\`id\`) ON UPDATE no action ON DELETE set null
)`,
  "CREATE UNIQUE INDEX IF NOT EXISTS `ciba_approval_reference_id_unique` ON `ciba_approval` (`reference_id`)",
  "CREATE UNIQUE INDEX IF NOT EXISTS `ciba_approval_token_jti_unique` ON `ciba_approval` (`token_jti`)",
  "CREATE INDEX IF NOT EXISTS `ciba_approval_user_decided_idx` ON `ciba_approval` (`user_id`,`decided_at`)",
  "CREATE INDEX IF NOT EXISTS `ciba_approval_client_id_idx` ON `ciba_approval` (`client_id`)",
  "CREATE INDEX IF NOT EXISTS `ciba_approval_agent_session_id_idx` ON `ciba_approval` (`agent_session_id`)",
];

// `drizzle-kit export` output for this index in oidc-credentials.ts, with IF
// NOT EXISTS added.
const OIDC4VCI_STATUS_ENTRY_INDEX_DDL =
  "CREATE UNIQUE INDEX IF NOT EXISTS `oidc4vci_issued_credential_status_entry_unique` ON `oidc4vci_issued_credential` (`status_list_id`,`status_list_index`)";

const OIDC4VCI_CREDENTIAL_NULLABLE_DDL =
  'ALTER TABLE `oidc4vci_issued_credential` ALTER COLUMN "credential" TO "credential" text';

const AGENT_CAPABILITY_GRANTABLE_DDL =
  "ALTER TABLE `agent_capability` ADD `grantable` integer DEFAULT false NOT NULL";

// The columns added to `ciba_approval` after this script first created it,
// for a table an earlier run created without them. The index statement in
// CIBA_APPROVAL_DDL runs after these.
const CIBA_APPROVAL_ADDED_COLUMNS = [
  ["token_jti", "text"],
  ["token_audience", "text"],
  ["token_issued_at", "integer"],
  ["poh_minted_at", "integer"],
  ["poh_jti", "text"],
] as const;

// `drizzle-kit push` output for this column in oauth-provider.ts.
const ACCESS_TOKEN_AUTH_CONTEXT_DDL =
  "ALTER TABLE `oauth_access_token` ADD `auth_context_id` text REFERENCES authentication_context(id) ON DELETE set null ON UPDATE no action";

const url = process.env.TURSO_DATABASE_URL || "file:./.data/dev.db";
const authToken = process.env.TURSO_AUTH_TOKEN;
const client = createClient(authToken ? { url, authToken } : { url });

// Mirrors the provider's `deriveSectorIdentifier` (oauth-provider
// `utils/index.ts`), which it does not export; replace with the export once it
// ships (U15 in docs/adr/platform/0002-better-auth-patches.md).
function deriveSectorIdentifier(
  clientId: string,
  redirectUris: readonly string[]
): string {
  const urls = redirectUris.map((uri) => new URL(uri));
  const first = urls[0];
  return first && urls.every((url) => url.protocol === "https:")
    ? first.host
    : `client/${clientId}`;
}

function parseRedirectUris(raw: unknown): string[] {
  if (typeof raw !== "string" || raw === "") {
    return [];
  }
  if (raw.startsWith("[")) {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((uri): uri is string => typeof uri === "string")
      : [];
  }
  return raw.split(" ").filter(Boolean);
}

/** The `UPDATE` statements that store a sector on every client row. */
async function clientSectorStatements(): Promise<InStatement[]> {
  const result = await client.execute(
    `SELECT client_id, redirect_uris, metadata_url FROM oauth_client
     WHERE sector_identifier IS NULL
        OR (metadata_url IS NOT NULL
            AND sector_identifier <> 'client/' || client_id)`
  );
  return result.rows.map((row) => {
    const clientId = String(row.client_id);
    const sector = row.metadata_url
      ? `client/${clientId}`
      : deriveSectorIdentifier(clientId, parseRedirectUris(row.redirect_uris));
    return {
      sql: `UPDATE oauth_client SET sector_identifier = ?
        WHERE client_id = ?
          AND (sector_identifier IS NULL
               OR (metadata_url IS NOT NULL
                   AND sector_identifier <> 'client/' || client_id))`,
      args: [sector, clientId],
    };
  });
}

async function hasTable(table: string): Promise<boolean> {
  const result = await client.execute({
    sql: "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
    args: [table],
  });
  return result.rows.length > 0;
}

async function hasColumn(table: string, column: string): Promise<boolean> {
  const result = await client.execute({
    sql: "SELECT 1 FROM pragma_table_info(?) WHERE name = ?",
    args: [table, column],
  });
  return result.rows.length > 0;
}

async function isNotNullColumn(
  table: string,
  column: string
): Promise<boolean> {
  const result = await client.execute({
    sql: 'SELECT 1 FROM pragma_table_info(?) WHERE name = ? AND "notnull" = 1',
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
  const revokeStoredCredentials = await hasColumn(
    "oidc4vci_issued_credential",
    "credential"
  );
  const allowNullCredential =
    revokeStoredCredentials &&
    (await isNotNullColumn("oidc4vci_issued_credential", "credential"));

  const addAccessTokenAuthContext = !(await hasColumn(
    "oauth_access_token",
    "auth_context_id"
  ));

  const timestampDefaults = await isoTimestampDefaultStatements();
  const addGrantable =
    (await hasTable("agent_capability")) &&
    !(await hasColumn("agent_capability", "grantable"));
  const createCibaApproval = !(await hasTable("ciba_approval"));
  const addedColumns: string[] = [];
  if (!createCibaApproval) {
    for (const [column, type] of CIBA_APPROVAL_ADDED_COLUMNS) {
      if (!(await hasColumn("ciba_approval", column))) {
        addedColumns.push(
          `ALTER TABLE \`ciba_approval\` ADD \`${column}\` ${type}`
        );
      }
    }
  }
  const [createCibaApprovalTable, ...cibaApprovalIndexes] = CIBA_APPROVAL_DDL;
  const schema = [
    ...timestampDefaults,
    ...HUMANITY_CREDENTIAL_UNIQUE_INDEXES,
    ...(addAccessTokenAuthContext ? [ACCESS_TOKEN_AUTH_CONTEXT_DDL] : []),
    ...FIRST_PARTY_APPS_DDL,
    ...(addGrantable ? [AGENT_CAPABILITY_GRANTABLE_DDL] : []),
    ...(createCibaApprovalTable ? [createCibaApprovalTable] : []),
    ...addedColumns,
    ...cibaApprovalIndexes,
    ...(allowNullCredential ? [OIDC4VCI_CREDENTIAL_NULLABLE_DDL] : []),
    OIDC4VCI_STATUS_ENTRY_INDEX_DDL,
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
    {
      sql: "DELETE FROM pairwise_subject WHERE subject_type = 'agent_session'",
      args: [],
    },
  ];
  const sectorStatements = await clientSectorStatements();
  statements.push(...sectorStatements);
  if (revokeStoredCredentials) {
    statements.push({
      sql: `UPDATE oidc4vci_issued_credential
        SET status = 1, revoked_at = :now
        WHERE status = 0 AND credential IS NOT NULL`,
      args: { now },
    });
  }
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
  const [markers, decoded, agentSubjects] = results.slice(schema.length);
  const sectorsStored = results
    .slice(schema.length + 3, schema.length + 3 + sectorStatements.length)
    .reduce((total, result) => total + result.rowsAffected, 0);
  const afterSectors = schema.length + 3 + sectorStatements.length;
  const revokedCredentials = revokeStoredCredentials
    ? results[afterSectors]
    : undefined;
  const copied = copyExchangeClaims ? results.at(-1) : undefined;
  console.log(`timestamp defaults moved: ${timestampDefaults.length}`);
  console.log(
    `oauth_access_token.auth_context_id: ${addAccessTokenAuthContext ? "added" : "already present"}`
  );
  console.log(
    `agent_capability.grantable: ${addGrantable ? "added" : "already present"}`
  );
  console.log(
    `ciba_approval: ${createCibaApproval ? "created" : "already present"}`
  );
  console.log(`ciba_approval columns added: ${addedColumns.length}`);
  console.log(
    `agent_session pairwise subjects deleted: ${agentSubjects?.rowsAffected ?? 0}`
  );
  console.log(`revocation markers added: ${markers?.rowsAffected ?? 0}`);
  console.log(`access_token_claims decoded: ${decoded?.rowsAffected ?? 0}`);
  console.log(`client sectors stored: ${sectorsStored}`);
  let credentialColumn = "dropped";
  if (allowNullCredential) {
    credentialColumn = "made nullable";
  } else if (revokeStoredCredentials) {
    credentialColumn = "already nullable";
  }
  console.log(`oidc4vci_issued_credential.credential: ${credentialColumn}`);
  console.log(
    revokeStoredCredentials
      ? `stored credentials revoked: ${revokedCredentials?.rowsAffected ?? 0}`
      : "stored credentials revoked: skipped (column already dropped)"
  );
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
