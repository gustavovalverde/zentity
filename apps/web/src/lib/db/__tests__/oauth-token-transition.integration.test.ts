import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db/connection";
import { passkeys } from "@/lib/db/schema/auth";
import { oauthAccessTokens } from "@/lib/db/schema/oauth-provider";
import { createTestUser, resetDatabase } from "@/test-utils/db-test-utils";

const TRAILING_COMMA_BEFORE_CLOSE = /,\n\)$/;

async function runTransitionScript(...args: string[]): Promise<string> {
  const { stdout } = await promisify(execFile)(
    "pnpm",
    ["exec", "tsx", "scripts/backfill-oauth-token-transition.ts", ...args],
    { env: process.env }
  );
  return stdout;
}

function cibaApprovalSchema() {
  return db.all<{ name: string; sql: string | null }>(
    sql`SELECT name, sql FROM sqlite_master WHERE tbl_name = 'ciba_approval' ORDER BY name`
  );
}

function issuedCredentialSchema() {
  return db.all<{ name: string; sql: string | null }>(
    sql`SELECT name, sql FROM sqlite_master WHERE tbl_name = 'oidc4vci_issued_credential' ORDER BY name`
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

function enrollmentColumns() {
  return Promise.all([
    db.all(
      sql`SELECT name, type, "notnull", dflt_value, pk FROM pragma_table_info('account') WHERE name = 'passwordSetMethod'`
    ),
    db.all(
      sql`SELECT name, type, "notnull", dflt_value, pk FROM pragma_table_info('passkey') WHERE name = 'enrollment_method'`
    ),
    db.all(
      sql`SELECT name, type, "notnull", dflt_value, pk FROM pragma_table_info('secret_wrappers') WHERE name = 'verifier_hash'`
    ),
  ]);
}

function userSchema() {
  return Promise.all([
    db.all(
      sql`SELECT name, type, "notnull", dflt_value, pk FROM pragma_table_info('user') ORDER BY cid`
    ),
    db.all(
      sql`SELECT name, "unique" FROM pragma_index_list('user') ORDER BY name`
    ),
  ]);
}

async function twoFactorState() {
  const [table] = await db.all<{ n: number }>(
    sql`SELECT count(*) AS n FROM sqlite_master WHERE tbl_name = 'two_factor'`
  );
  const [column] = await db.all<{ n: number }>(
    sql`SELECT count(*) AS n FROM pragma_table_info('user') WHERE name = 'two_factor_enabled'`
  );
  return { tableObjects: table?.n, column: column?.n };
}

// The production schema's two-factor table and column (release 5b4283aa),
// holding one enrolled user.
async function addProductionTwoFactor(userId: string): Promise<void> {
  await db.run(sql`CREATE TABLE two_factor (
    id text PRIMARY KEY NOT NULL,
    secret text NOT NULL,
    backup_codes text NOT NULL,
    user_id text NOT NULL,
    verified integer DEFAULT true,
    failed_verification_count integer DEFAULT 0,
    locked_until integer,
    FOREIGN KEY (user_id) REFERENCES user(id) ON UPDATE no action ON DELETE cascade
  )`);
  await db.run(sql`CREATE INDEX twoFactor_secret_idx ON two_factor (secret)`);
  await db.run(sql`CREATE INDEX twoFactor_userId_idx ON two_factor (user_id)`);
  await db.run(
    sql`ALTER TABLE user ADD two_factor_enabled integer DEFAULT false NOT NULL`
  );
  await db.run(
    sql`UPDATE user SET two_factor_enabled = 1 WHERE id = ${userId}`
  );
  await db.run(
    sql`INSERT INTO two_factor (id, secret, backup_codes, user_id) VALUES ('tf1', 'secret', 'codes', ${userId})`
  );
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
  beforeEach(async () => {
    await resetDatabase();
  });

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

  it("lets a release that keeps no SD-JWT record credentials, and revokes the ones that carry a subject", async () => {
    const pushed = await issuedCredentialSchema();
    const userId = await createTestUser();
    // The previous release's table: the SD-JWT column, no unique entry index.
    await db.run(
      sql`DROP INDEX oidc4vci_issued_credential_status_entry_unique`
    );
    await db.run(
      sql`ALTER TABLE oidc4vci_issued_credential ADD credential text NOT NULL DEFAULT ''`
    );
    const insert = (index: number, status: number, credential: string | null) =>
      db.run(
        sql`INSERT INTO oidc4vci_issued_credential
          (user_id, credential_configuration_id, format, status_list_id, status_list_index, status, credential)
          VALUES (${userId}, 'identity_verification', 'dc+sd-jwt', 'default', ${index}, ${status}, ${credential})`
      );
    await insert(0, 0, "issued-with-sub");
    await insert(1, 1, "already-revoked");

    const output = await runTransitionScript();
    expect(output).toContain(
      "oidc4vci_issued_credential.credential: made nullable"
    );
    expect(output).toContain("stored credentials revoked: 1");
    await insert(2, 0, null);
    expect(
      await db.all(
        sql`SELECT status_list_index AS idx, status, revoked_at IS NOT NULL AS revoked
          FROM oidc4vci_issued_credential ORDER BY status_list_index`
      )
    ).toEqual([
      { idx: 0, status: 1, revoked: 1 },
      { idx: 1, status: 1, revoked: 0 },
      { idx: 2, status: 0, revoked: 0 },
    ]);
    await expect(insert(2, 0, null)).rejects.toThrow();

    const again = await runTransitionScript();
    expect(again).toContain(
      "oidc4vci_issued_credential.credential: already nullable"
    );
    expect(again).toContain("stored credentials revoked: 0");

    await db.run(
      sql`ALTER TABLE oidc4vci_issued_credential DROP COLUMN credential`
    );
    expect(await issuedCredentialSchema()).toEqual(pushed);
    expect(await runTransitionScript()).toContain(
      "stored credentials revoked: skipped (column already dropped)"
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

  it("adds the passkey enrollment record columns as db:push does, before the release serves traffic", async () => {
    const pushed = await enrollmentColumns();
    expect(pushed.flat()).toHaveLength(3);
    const userId = await createTestUser();

    await db.run(sql`ALTER TABLE account DROP COLUMN passwordSetMethod`);
    await db.run(sql`ALTER TABLE passkey DROP COLUMN enrollment_method`);
    await db.run(sql`ALTER TABLE secret_wrappers DROP COLUMN verifier_hash`);
    await expect(
      db.insert(passkeys).values({
        id: "transition-probe",
        publicKey: "key",
        userId,
        credentialID: "transition-probe",
        deviceType: "singleDevice",
      })
    ).rejects.toMatchObject({
      cause: { message: expect.stringContaining("enrollment_method") },
    });

    expect(await runTransitionScript()).toContain(
      "account.passwordSetMethod, passkey.enrollment_method, and secret_wrappers.verifier_hash: 3 added"
    );
    expect(await enrollmentColumns()).toEqual(pushed);
    expect(await runTransitionScript()).toContain(
      "account.passwordSetMethod, passkey.enrollment_method, and secret_wrappers.verifier_hash: 0 added"
    );
  });

  it("drops the two-factor table and column only after the deploy", async () => {
    const pushed = await userSchema();
    const userId = await createTestUser();
    await db.run(
      sql`INSERT INTO session (id, token, userId, expiresAt, createdAt, updatedAt)
        VALUES ('s1', 't1', ${userId}, 0, 0, 0)`
    );
    await addProductionTwoFactor(userId);

    expect(await runTransitionScript()).toContain(
      "two_factor and user.two_factor_enabled: kept until --after-deploy"
    );
    expect(await twoFactorState()).toEqual({ tableObjects: 4, column: 1 });

    expect(await runTransitionScript("--after-deploy")).toContain(
      "two_factor and user.two_factor_enabled: dropped"
    );
    expect(await twoFactorState()).toEqual({ tableObjects: 0, column: 0 });
    expect(await userSchema()).toEqual(pushed);
    expect(
      await db.all(
        sql`SELECT u.id, s.id AS session FROM user u JOIN session s ON s.userId = u.id`
      )
    ).toEqual([{ id: userId, session: "s1" }]);

    expect(await runTransitionScript("--after-deploy")).toContain(
      "two_factor and user.two_factor_enabled: already dropped"
    );
  });
});
