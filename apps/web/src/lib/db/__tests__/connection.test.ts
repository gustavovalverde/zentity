import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { getSqliteDb } from "@/lib/db/connection";

function getTableNames(db: ReturnType<typeof getSqliteDb>): string[] {
  const rows = db
    .query("select name from sqlite_master where type = 'table'")
    .all() as Array<{ name: string }>;
  return rows.map((row) => row.name);
}

describe("db connection", () => {
  it("does not auto-create schema without drizzle-kit push", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "zentity-db-"));
    const dbPath = join(tmpDir, "test.db");
    const db = getSqliteDb(dbPath);

    const tableNames = getTableNames(db);

    expect(tableNames).not.toContain("user");

    try {
      db.close();
    } catch {
      // Best-effort cleanup.
    }
    rmSync(tmpDir, { recursive: true, force: true });
  });
});
