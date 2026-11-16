import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { db } from "@/lib/db/connection";
import { oauthAccessTokens } from "@/lib/db/schema/oauth-provider";

const TRAILING_COMMA_BEFORE_CLOSE = /,\n\)$/;

async function runTransitionScript(): Promise<string> {
  const { stdout } = await promisify(execFile)(
    "pnpm",
    ["exec", "tsx", "scripts/backfill-oauth-token-transition.ts"],
    { env: process.env }
  );
  return stdout;
}

async function accessTokenAuthContext() {
  return {
    columns: await db.all(
      sql`SELECT name, type, "notnull", dflt_value, pk FROM pragma_table_info('oauth_access_token') WHERE name = 'auth_context_id'`
    ),
    foreignKeys: await db.all(
      sql`SELECT "table", "to", on_update, on_delete FROM pragma_foreign_key_list('oauth_access_token') WHERE "from" = 'auth_context_id'`
    ),
  };
}

// Rebuilds `oauth_access_token` as main's `pnpm db:push` (#321) leaves it.
// SQLite cannot drop a column that a foreign key names.
async function dropAccessTokenAuthContext(): Promise<void> {
  const [table] = await db.all<{ sql: string }>(
    sql`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'oauth_access_token'`
  );
  const indexes = await db.all<{ sql: string }>(
    sql`SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'oauth_access_token' AND sql IS NOT NULL`
  );
  const columns = (
    await db.all<{ name: string }>(
      sql`SELECT name FROM pragma_table_info('oauth_access_token') WHERE name <> 'auth_context_id'`
    )
  )
    .map(({ name }) => `\`${name}\``)
    .join(", ");
  const createTable = (table?.sql ?? "")
    .replace("`oauth_access_token`", "`oauth_access_token_rebuilt`")
    .split("\n")
    .filter((line) => !line.includes("`auth_context_id`"))
    .join("\n")
    .replace(TRAILING_COMMA_BEFORE_CLOSE, "\n)");

  await db.run(sql.raw(createTable));
  await db.run(
    sql.raw(
      `INSERT INTO oauth_access_token_rebuilt (${columns}) SELECT ${columns} FROM oauth_access_token`
    )
  );
  await db.run(sql`DROP TABLE oauth_access_token`);
  await db.run(
    sql`ALTER TABLE oauth_access_token_rebuilt RENAME TO oauth_access_token`
  );
  for (const index of indexes) {
    await db.run(sql.raw(index.sql));
  }
}

describe("deploy backfill", () => {
  it("adds oauth_access_token.auth_context_id as db:push does, before the release serves traffic", async () => {
    const pushed = await accessTokenAuthContext();
    expect(pushed.columns).toHaveLength(1);
    expect(pushed.foreignKeys).toHaveLength(1);

    await dropAccessTokenAuthContext();
    expect(await accessTokenAuthContext()).toEqual({
      columns: [],
      foreignKeys: [],
    });
    await expect(
      db.insert(oauthAccessTokens).values({
        token: "transition-probe",
        clientId: "transition-probe",
        expiresAt: new Date(),
        scopes: "[]",
      })
    ).rejects.toMatchObject({
      cause: { message: expect.stringContaining("auth_context_id") },
    });

    expect(await runTransitionScript()).toContain(
      "oauth_access_token.auth_context_id: added"
    );
    expect(await accessTokenAuthContext()).toEqual(pushed);

    expect(await runTransitionScript()).toContain(
      "oauth_access_token.auth_context_id: already present"
    );
    expect(await accessTokenAuthContext()).toEqual(pushed);
  });
});
