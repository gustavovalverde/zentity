import { createClient } from "@libsql/client";

const APPLY_FLAG = "--apply";
const DEFAULT_DATABASE_URL = "file:./.data/demo-rp.db";
const TRAILING_SLASHES = /\/+$/;

interface CountRow {
  count: number;
}

interface DuplicateAccountRow {
  count: number;
  identityKey: string;
  userCount: number;
}

const databaseUrl = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
const authToken = process.env.DATABASE_AUTH_TOKEN;
const zentityUrl = (process.env.ZENTITY_URL ?? "http://localhost:3000").replace(
  TRAILING_SLASHES,
  ""
);
const accountIssuer = `${zentityUrl}/api/auth`;
const shouldApply = process.argv.includes(APPLY_FLAG);
const client = createClient({
  url: databaseUrl,
  ...(authToken ? { authToken } : {}),
});

function fail(message: string): never {
  throw new Error(`Better Auth 1.7 demo preparation refused: ${message}`);
}

async function countAccounts(): Promise<number> {
  const result = await client.execute("SELECT COUNT(*) AS count FROM account");
  return Number(
    (result.rows[0] as unknown as CountRow | undefined)?.count ?? 0
  );
}

async function main() {
  const tableInfo = await client.execute("PRAGMA table_info('account')");
  if (tableInfo.rows.length === 0) {
    fail("account table does not exist; run pnpm db:push first");
  }

  const columns = new Set(tableInfo.rows.map((row) => String(row.name)));
  const issuerIsNotNull = tableInfo.rows.some(
    (row) => row.name === "issuer" && Number(row.notnull) === 1
  );
  const accountCount = await countAccounts();
  const projectedIssuer = columns.has("issuer")
    ? "COALESCE(NULLIF(issuer, ''), ?)"
    : "?";
  const duplicateResult = await client.execute({
    sql: `SELECT ${projectedIssuer} || ':' || accountId AS identity_key,
                 COUNT(*) AS count,
                 COUNT(DISTINCT userId) AS user_count
          FROM account
          GROUP BY ${projectedIssuer}, accountId
          HAVING COUNT(*) > 1`,
    args: [accountIssuer, accountIssuer],
  });
  const duplicates = duplicateResult.rows.map((row) => ({
    count: Number(row.count),
    identityKey: String(row.identity_key),
    userCount: Number(row.user_count),
  })) satisfies DuplicateAccountRow[];
  const crossUserCollisions = duplicates.filter((row) => row.userCount > 1);
  if (crossUserCollisions.length > 0) {
    const collisions = crossUserCollisions
      .map(
        (row) =>
          `${row.identityKey} (${row.count} accounts across ${row.userCount} users)`
      )
      .join(", ");
    fail(
      `issuer and subject identities collide: ${collisions}. Reset this disposable demo database or consolidate those users explicitly before retrying`
    );
  }
  const redundantAliasCount = duplicates.reduce(
    (count, row) => count + row.count - 1,
    0
  );
  const migratedAccountCount = accountCount - redundantAliasCount;

  const unexpectedIssuer = columns.has("issuer")
    ? await client.execute({
        sql: "SELECT issuer FROM account WHERE issuer IS NOT NULL AND issuer != '' AND issuer != ? LIMIT 1",
        args: [accountIssuer],
      })
    : { rows: [] };
  if (unexpectedIssuer.rows.length > 0) {
    fail(
      `account rows belong to a different issuer (${String(unexpectedIssuer.rows[0]?.issuer)}); migrate that issuer explicitly`
    );
  }

  if (!shouldApply) {
    console.log(
      `Preflight passed for ${accountCount} account row(s). Re-run with ${APPLY_FLAG} to backfill issuer ${accountIssuer}${
        redundantAliasCount > 0
          ? ` and consolidate ${redundantAliasCount} redundant same-user provider alias row(s)`
          : ""
      }.`
    );
    return;
  }

  if (!columns.has("issuer")) {
    await client.execute("ALTER TABLE account ADD COLUMN issuer TEXT");
  }
  await client.execute({
    sql: "UPDATE account SET issuer = ? WHERE issuer IS NULL OR issuer = ''",
    args: [accountIssuer],
  });
  if (redundantAliasCount > 0) {
    await client.execute(`DELETE FROM account
      WHERE id IN (
        SELECT id
        FROM (
          SELECT id,
                 ROW_NUMBER() OVER (
                   PARTITION BY issuer, accountId
                   ORDER BY updatedAt DESC, createdAt DESC, id DESC
                 ) AS duplicate_rank
          FROM account
        )
        WHERE duplicate_rank > 1
      )`);
  }

  if (!issuerIsNotNull) {
    await client.batch(
      [
        `CREATE TABLE account_better_auth_1_7 (
          id TEXT PRIMARY KEY NOT NULL,
          issuer TEXT NOT NULL,
          accountId TEXT NOT NULL,
          providerId TEXT NOT NULL,
          userId TEXT NOT NULL,
          accessToken TEXT,
          refreshToken TEXT,
          idToken TEXT,
          accessTokenExpiresAt TEXT,
          refreshTokenExpiresAt TEXT,
          scope TEXT,
          password TEXT,
          createdAt TEXT NOT NULL DEFAULT (datetime('now')),
          updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (userId) REFERENCES user(id) ON UPDATE NO ACTION ON DELETE NO ACTION
        )`,
        `INSERT INTO account_better_auth_1_7 (
          id, issuer, accountId, providerId, userId, accessToken, refreshToken,
          idToken, accessTokenExpiresAt, refreshTokenExpiresAt, scope, password,
          createdAt, updatedAt
        )
        SELECT
          id, issuer, accountId, providerId, userId, accessToken, refreshToken,
          idToken, accessTokenExpiresAt, refreshTokenExpiresAt, scope, password,
          createdAt, updatedAt
        FROM account`,
        "DROP TABLE account",
        "ALTER TABLE account_better_auth_1_7 RENAME TO account",
      ],
      "write"
    );
  }

  await client.execute(
    "CREATE UNIQUE INDEX IF NOT EXISTS account_issuer_accountId_unique ON account (issuer, accountId)"
  );
  const missingIssuer = await client.execute(
    "SELECT id FROM account WHERE issuer IS NULL OR issuer = '' LIMIT 1"
  );
  if (missingIssuer.rows.length > 0) {
    fail("an account remains without an issuer after backfill");
  }
  if ((await countAccounts()) !== migratedAccountCount) {
    fail("account row count changed unexpectedly during backfill");
  }

  console.log(
    `Migrated ${accountCount} legacy account row(s) to ${migratedAccountCount} issuer-scoped account row(s) for ${accountIssuer}. Review the database, then run pnpm db:push.`
  );
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(() => client.close());
