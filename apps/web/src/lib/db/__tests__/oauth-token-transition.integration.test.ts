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

function cibaApprovalSchema() {
  return db.all<{ name: string; sql: string | null }>(
    sql`SELECT name, sql FROM sqlite_master WHERE tbl_name = 'ciba_approval' ORDER BY name`
  );
}

function cibaApprovalColumns() {
  return db.all<{ name: string; type: string; notnull: number }>(
    sql`SELECT name, type, "notnull" FROM pragma_table_info('ciba_approval') ORDER BY cid`
  );
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
  it("creates ciba_approval exactly as db:push does, before the release serves traffic", async () => {
    const pushed = await cibaApprovalSchema();
    expect(pushed.map((row) => row.name)).toEqual([
      "ciba_approval",
      "ciba_approval_agent_session_id_idx",
      "ciba_approval_client_id_idx",
      "ciba_approval_reference_id_unique",
      "ciba_approval_token_jti_unique",
      "ciba_approval_user_decided_idx",
      "sqlite_autoindex_ciba_approval_1",
    ]);

    await db.run(sql`DROP TABLE ciba_approval`);
    expect(await cibaApprovalSchema()).toEqual([]);

    expect(await runTransitionScript()).toContain("ciba_approval: created");
    expect(await cibaApprovalSchema()).toEqual(pushed);

    expect(await runTransitionScript()).toContain(
      "ciba_approval: already present"
    );
    expect(await cibaApprovalSchema()).toEqual(pushed);
  });

  it("adds the token and Proof-of-Human columns to a ciba_approval created without them", async () => {
    const pushedColumns = await cibaApprovalColumns();
    const pushedIndexes = (await cibaApprovalSchema()).map((row) => row.name);
    await db.run(sql`DROP INDEX ciba_approval_token_jti_unique`);
    for (const column of [
      "token_jti",
      "token_audience",
      "token_issued_at",
      "poh_minted_at",
      "poh_jti",
    ]) {
      await db.run(sql.raw(`ALTER TABLE ciba_approval DROP COLUMN ${column}`));
    }

    expect(await runTransitionScript()).toContain(
      "ciba_approval columns added: 5"
    );
    expect(await cibaApprovalColumns()).toEqual(pushedColumns);
    expect((await cibaApprovalSchema()).map((row) => row.name)).toEqual(
      pushedIndexes
    );
    expect(await runTransitionScript()).toContain(
      "ciba_approval columns added: 0"
    );
  });

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
