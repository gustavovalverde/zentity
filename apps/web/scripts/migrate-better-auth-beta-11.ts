import { createClient } from "@libsql/client";

const url = process.env.TURSO_DATABASE_URL;
if (!url) {
  throw new Error("Set TURSO_DATABASE_URL to the web database to migrate.");
}
const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });

async function migrate() {
  const tx = await client.transaction("write");
  let changes = 0;
  try {
    for (const [table, column, type] of [
      ["ciba_request", "actor", "text"],
      ["ciba_request", "approved_via_consent", "integer"],
      ["oauth_resource", "access_token_format", "text"],
    ] as const) {
      const existing = await tx.execute({
        sql: "SELECT name FROM pragma_table_info(?) WHERE name = ?",
        args: [table, column],
      });
      if (existing.rows.length === 0) {
        await tx.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
        changes++;
      }
    }

    const flag = await tx.execute(
      `SELECT "notnull", dflt_value FROM pragma_table_info('oauth_client')
       WHERE name = 'dpop_bound_access_tokens'`
    );
    const column = flag.rows[0];
    if (!column) {
      throw new Error("Expected the beta.10 oauth_client schema.");
    }
    if (
      column.notnull !== 0 ||
      !["0", "false"].includes(String(column.dflt_value).toLowerCase())
    ) {
      await tx.execute(
        "ALTER TABLE oauth_client ALTER COLUMN dpop_bound_access_tokens TO dpop_bound_access_tokens INTEGER DEFAULT false"
      );
      changes++;
    }
    await tx.commit();
    console.log(`Applied ${changes} Better Auth beta.11 schema changes.`);
  } finally {
    tx.close();
  }
}

migrate()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => client.close());
