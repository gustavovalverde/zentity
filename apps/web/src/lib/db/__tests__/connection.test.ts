import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createClient } from "@libsql/client";
import { describe, expect, it } from "vitest";

async function getTableNames(dbUrl: string): Promise<string[]> {
  const client = createClient({ url: dbUrl });
  try {
    const result = await client.execute(
      "select name from sqlite_master where type = 'table'"
    );
    return result.rows
      .map((row) => String((row as Record<string, unknown>).name))
      .filter(Boolean);
  } finally {
    try {
      client.close();
    } catch {
      // Best-effort cleanup.
    }
  }
}

describe("db connection", () => {
  it("does not auto-create schema without drizzle-kit push", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "zentity-db-"));
    const dbPath = join(tmpDir, "test.db");
    const dbUrl = `file:${dbPath}`;

    const tableNames = await getTableNames(dbUrl);

    expect(tableNames).not.toContain("user");

    rmSync(tmpDir, { recursive: true, force: true });
  });
});
