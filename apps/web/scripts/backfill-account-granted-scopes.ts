/**
 * Backfill `account.grantedScopes` from the legacy comma-separated `account.scope`
 * column (better-auth 1.7 renamed the field and changed its type to string[]).
 *
 * Run BEFORE `db:push` drops the legacy `scope` column:
 *
 *   pnpm tsx scripts/backfill-account-granted-scopes.ts
 *
 * Idempotent: rows whose `grantedScopes` is already populated are skipped, and a
 * second run after the legacy column is gone is a no-op.
 */
import { createClient } from "@libsql/client";

const url = process.env.TURSO_DATABASE_URL ?? "file:./.data/dev.db";
const authToken = process.env.TURSO_AUTH_TOKEN;

const client = createClient(authToken ? { url, authToken } : { url });

const SCOPE_SEPARATOR_RE = /[,\s]+/;

function normalizeScopes(raw: string): string[] {
  const seen = new Set<string>();
  for (const part of raw.split(SCOPE_SEPARATOR_RE)) {
    const trimmed = part.trim();
    if (trimmed) {
      seen.add(trimmed);
    }
  }
  return [...seen];
}

async function main(): Promise<void> {
  // Detect the legacy column; if it is already gone, there is nothing to do.
  const columns = await client.execute("PRAGMA table_info('account')");
  const hasLegacyScope = columns.rows.some((row) => row.name === "scope");
  const hasGrantedScopes = columns.rows.some(
    (row) => row.name === "grantedScopes"
  );

  if (!hasLegacyScope) {
    process.stdout.write(
      "No legacy `scope` column on account; nothing to backfill.\n"
    );
    return;
  }
  if (!hasGrantedScopes) {
    process.stdout.write(
      "Run `db:push` to add the `grantedScopes` column, then re-run this backfill before the legacy column is dropped.\n"
    );
    return;
  }

  const rows = await client.execute(
    "SELECT id, scope FROM account WHERE scope IS NOT NULL AND scope != '' AND (grantedScopes IS NULL OR grantedScopes = '')"
  );

  let updated = 0;
  for (const row of rows.rows) {
    const id = String(row.id);
    const scope = typeof row.scope === "string" ? row.scope : "";
    const scopes = normalizeScopes(scope);
    if (scopes.length === 0) {
      continue;
    }
    await client.execute({
      sql: "UPDATE account SET grantedScopes = ? WHERE id = ?",
      args: [JSON.stringify(scopes), id],
    });
    updated += 1;
  }

  process.stdout.write(`Backfilled grantedScopes for ${updated} account(s).\n`);
}

main()
  .then(() => client.close())
  .catch((error: unknown) => {
    process.stderr.write(
      `Backfill failed: ${error instanceof Error ? error.message : String(error)}\n`
    );
    client.close();
    process.exit(1);
  });
