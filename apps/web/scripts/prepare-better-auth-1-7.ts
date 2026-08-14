import { createClient, type InValue } from "@libsql/client";

const APPLY_FLAG = "--apply";
const DEFAULT_DATABASE_URL = "file:./.data/dev.db";
const LOCAL_ACCOUNT_ISSUERS = new Map([
  ["credential", "local:credential"],
  ["eip712", "local:eip712"],
  ["opaque", "local:opaque"],
]);

interface CountRow {
  count: number;
}

interface ProviderRow {
  issuer: string | null;
  providerId: string;
}

interface DuplicateRow {
  count: number;
  key: string;
}

const databaseUrl = process.env.TURSO_DATABASE_URL ?? DEFAULT_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
const shouldApply = process.argv.includes(APPLY_FLAG);
const client = createClient({
  url: databaseUrl,
  ...(authToken ? { authToken } : {}),
});

async function tableColumns(table: string): Promise<Set<string>> {
  const result = await client.execute(`PRAGMA table_info('${table}')`);
  return new Set(result.rows.map((row) => String(row.name)));
}

async function countRows(table: string): Promise<number> {
  const result = await client.execute(`SELECT COUNT(*) AS count FROM ${table}`);
  return Number(
    (result.rows[0] as unknown as CountRow | undefined)?.count ?? 0
  );
}

async function duplicateRows(query: string): Promise<DuplicateRow[]> {
  const result = await client.execute(query);
  return result.rows.map((row) => ({
    count: Number(row.count),
    key: String(row.key),
  }));
}

function fail(message: string): never {
  throw new Error(`Better Auth 1.7 preparation refused: ${message}`);
}

async function main() {
  const accountInfo = await client.execute("PRAGMA table_info('account')");
  const accountColumns = await tableColumns("account");
  const oauthClientColumns = await tableColumns("oauth_client");
  const issuerIsNotNull = accountInfo.rows.some(
    (row) => row.name === "issuer" && Number(row.notnull) === 1
  );
  const accountCount = await countRows("account");
  const clientCount = await countRows("oauth_client");

  const issuerExpression = accountColumns.has("issuer") ? "issuer" : "NULL";
  const providerResult = await client.execute(
    `SELECT providerId, ${issuerExpression} AS issuer FROM account GROUP BY providerId, ${issuerExpression}`
  );
  const providers = providerResult.rows.map((row) => ({
    issuer: row.issuer === null ? null : String(row.issuer),
    providerId: String(row.providerId),
  })) satisfies ProviderRow[];
  const unmappedProviders = providers.filter(
    ({ issuer, providerId }) =>
      !(issuer || LOCAL_ACCOUNT_ISSUERS.has(providerId))
  );
  if (unmappedProviders.length > 0) {
    fail(
      `account provider issuer mapping is unknown for: ${unmappedProviders
        .map(({ providerId }) => providerId)
        .join(", ")}`
    );
  }

  const projectedIssuer = accountColumns.has("issuer")
    ? `COALESCE(issuer, CASE providerId
        WHEN 'credential' THEN 'local:credential'
        WHEN 'eip712' THEN 'local:eip712'
        WHEN 'opaque' THEN 'local:opaque'
      END)`
    : `CASE providerId
        WHEN 'credential' THEN 'local:credential'
        WHEN 'eip712' THEN 'local:eip712'
        WHEN 'opaque' THEN 'local:opaque'
      END`;
  const projectedAccountId =
    "CASE WHEN providerId = 'credential' THEN userId ELSE accountId END";
  const accountDuplicates = await duplicateRows(`
    SELECT ${projectedIssuer} || ':' || ${projectedAccountId} AS key,
           COUNT(*) AS count
    FROM account
    GROUP BY ${projectedIssuer}, ${projectedAccountId}
    HAVING COUNT(*) > 1
  `);
  if (accountDuplicates.length > 0) {
    fail(
      `projected account identities collide: ${accountDuplicates
        .map(({ count, key }) => `${key} (${count})`)
        .join(", ")}`
    );
  }

  for (const table of ["oauth_access_token", "oauth_refresh_token"]) {
    const tokenDuplicates = await duplicateRows(`
      SELECT token AS key, COUNT(*) AS count
      FROM ${table}
      GROUP BY token
      HAVING COUNT(*) > 1
    `);
    if (tokenDuplicates.length > 0) {
      fail(`${table} contains duplicate token values`);
    }
  }

  const resourceDuplicates = await duplicateRows(`
    SELECT client_resource.client_id || ':' || COALESCE(resource.identifier, client_resource.resource_id) AS key,
           COUNT(*) AS count
    FROM oauth_client_resource AS client_resource
    LEFT JOIN oauth_resource AS resource
      ON resource.id = client_resource.resource_id
      OR resource.identifier = client_resource.resource_id
    GROUP BY client_resource.client_id, COALESCE(resource.identifier, client_resource.resource_id)
    HAVING COUNT(*) > 1
  `);
  if (resourceDuplicates.length > 0) {
    fail(
      `oauth client-resource links collide after identifier migration: ${resourceDuplicates
        .map(({ count, key }) => `${key} (${count})`)
        .join(", ")}`
    );
  }

  const unresolvedResources = await client.execute(`
    SELECT client_resource.resource_id
    FROM oauth_client_resource AS client_resource
    LEFT JOIN oauth_resource AS resource
      ON resource.id = client_resource.resource_id
      OR resource.identifier = client_resource.resource_id
    WHERE resource.id IS NULL
    LIMIT 1
  `);
  if (unresolvedResources.rows.length > 0) {
    fail(
      `oauth client-resource link references an unknown resource: ${String(
        unresolvedResources.rows[0]?.resource_id
      )}`
    );
  }

  if (oauthClientColumns.has("type")) {
    const unsupportedTypes = await client.execute(
      "SELECT client_id, type FROM oauth_client WHERE type IS NOT NULL AND type NOT IN ('web', 'native') LIMIT 1"
    );
    if (unsupportedTypes.rows.length > 0) {
      fail(
        `OAuth client ${String(unsupportedTypes.rows[0]?.client_id)} has unsupported legacy type ${String(
          unsupportedTypes.rows[0]?.type
        )}`
      );
    }
  }

  const machineClients = await client.execute(
    "SELECT client_id FROM oauth_client WHERE grant_types LIKE '%client_credentials%' LIMIT 1"
  );
  if (machineClients.rows.length > 0) {
    fail(
      `OAuth client ${String(
        machineClients.rows[0]?.client_id
      )} uses client_credentials; assign its approved machine scopes manually before migration`
    );
  }

  if (!shouldApply) {
    console.log(
      `Preflight passed for ${accountCount} account row(s) and ${clientCount} OAuth client row(s). Re-run with ${APPLY_FLAG} to backfill.`
    );
    return;
  }

  const statements: Array<{ args?: InValue[]; sql: string }> = [];
  if (!accountColumns.has("issuer")) {
    statements.push({ sql: "ALTER TABLE account ADD COLUMN issuer TEXT" });
  }
  statements.push(
    {
      sql: "UPDATE account SET issuer = 'local:credential', accountId = userId WHERE providerId = 'credential' AND (issuer IS NULL OR issuer = '')",
    },
    {
      sql: "UPDATE account SET issuer = 'local:eip712' WHERE providerId = 'eip712' AND (issuer IS NULL OR issuer = '')",
    },
    {
      sql: "UPDATE account SET issuer = 'local:opaque' WHERE providerId = 'opaque' AND (issuer IS NULL OR issuer = '')",
    }
  );
  if (!issuerIsNotNull) {
    statements.push(
      {
        sql: `CREATE TABLE account_better_auth_1_7 (
          id TEXT PRIMARY KEY NOT NULL,
          accountId TEXT NOT NULL,
          providerId TEXT NOT NULL,
          issuer TEXT NOT NULL,
          userId TEXT NOT NULL,
          accessToken TEXT,
          refreshToken TEXT,
          idToken TEXT,
          accessTokenExpiresAt INTEGER,
          refreshTokenExpiresAt INTEGER,
          scope TEXT,
          password TEXT,
          registrationRecord TEXT,
          createdAt INTEGER NOT NULL,
          updatedAt INTEGER NOT NULL,
          FOREIGN KEY (userId) REFERENCES user(id) ON UPDATE NO ACTION ON DELETE CASCADE
        )`,
      },
      {
        sql: `INSERT INTO account_better_auth_1_7 (
          id, accountId, providerId, issuer, userId, accessToken, refreshToken,
          idToken, accessTokenExpiresAt, refreshTokenExpiresAt, scope, password,
          registrationRecord, createdAt, updatedAt
        )
        SELECT
          id, accountId, providerId, issuer, userId, accessToken, refreshToken,
          idToken, accessTokenExpiresAt, refreshTokenExpiresAt, scope, password,
          registrationRecord, createdAt, updatedAt
        FROM account`,
      },
      { sql: "DROP TABLE account" },
      {
        sql: "ALTER TABLE account_better_auth_1_7 RENAME TO account",
      },
      {
        sql: "CREATE INDEX account_userId_idx ON account (userId)",
      },
      {
        sql: "CREATE UNIQUE INDEX account_registration_record_unique ON account (registrationRecord)",
      }
    );
  }

  for (const column of [
    "application_type",
    "client_discovery_id",
    "client_credentials_scopes",
  ]) {
    if (!oauthClientColumns.has(column)) {
      statements.push({
        sql: `ALTER TABLE oauth_client ADD COLUMN ${column} TEXT`,
      });
    }
  }
  statements.push({
    sql: `UPDATE oauth_client
      SET application_type = CASE
        WHEN type IN ('web', 'native') THEN type
        WHEN client_id = 'zentity-wallet' THEN 'native'
        ELSE 'web'
      END
      WHERE application_type IS NULL`,
  });
  if (oauthClientColumns.has("public")) {
    statements.push({
      sql: `UPDATE oauth_client
        SET token_endpoint_auth_method = 'none'
        WHERE public = 1 AND token_endpoint_auth_method IS NULL`,
    });
  }
  statements.push(
    {
      sql: "UPDATE oauth_client SET client_credentials_scopes = '[]' WHERE client_credentials_scopes IS NULL",
    },
    {
      sql: `UPDATE oauth_client_resource
        SET resource_id = (
          SELECT identifier FROM oauth_resource
          WHERE oauth_resource.id = oauth_client_resource.resource_id
        )
        WHERE EXISTS (
          SELECT 1 FROM oauth_resource
          WHERE oauth_resource.id = oauth_client_resource.resource_id
        )`,
    }
  );

  await client.batch(statements, "write");

  const missingIssuer = await client.execute(
    "SELECT id FROM account WHERE issuer IS NULL OR issuer = '' LIMIT 1"
  );
  if (missingIssuer.rows.length > 0) {
    fail("an account remains without an issuer after backfill");
  }
  if ((await countRows("account")) !== accountCount) {
    fail("account row count changed during backfill");
  }
  if ((await countRows("oauth_client")) !== clientCount) {
    fail("OAuth client row count changed during backfill");
  }
  await client.execute(
    "CREATE UNIQUE INDEX IF NOT EXISTS account_issuer_accountId_unique ON account (issuer, accountId)"
  );

  console.log(
    `Backfilled ${accountCount} account row(s) and ${clientCount} OAuth client row(s). Review the database, then run pnpm db:push.`
  );
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(() => client.close());
