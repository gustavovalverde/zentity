// @vitest-environment node
import { createClient } from "@libsql/client";
import {
  generateSQLiteDrizzleJson,
  generateSQLiteMigration,
} from "drizzle-kit/api";
import { desc } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { getTableConfig, SQLiteTable } from "drizzle-orm/sqlite-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// biome-ignore lint/performance/noNamespaceImport: drizzle-kit snapshots every exported table
import * as schema from "./schema";

describe("demo-rp schema defaults", () => {
  it("never stores a SQL expression as a quoted string literal", () => {
    const literalDefaults: string[] = [];
    let columnCount = 0;
    for (const table of Object.values(schema)) {
      if (!(table instanceof SQLiteTable)) {
        continue;
      }
      const config = getTableConfig(table);
      for (const column of config.columns) {
        columnCount += 1;
        if (
          typeof column.default === "string" &&
          column.default.includes("(")
        ) {
          literalDefaults.push(`${config.name}.${column.name}`);
        }
      }
    }
    expect(columnCount).toBeGreaterThan(0);
    expect(literalDefaults).toEqual([]);
  });

  describe("validity_notice.receivedAt", () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("records insert time so the latest notice orders first", async () => {
      const client = createClient({ url: ":memory:" });
      const db = drizzle(client, { schema });
      const empty = await generateSQLiteDrizzleJson({});
      const current = await generateSQLiteDrizzleJson(schema);
      await client.batch(await generateSQLiteMigration(empty, current));

      const notice = (eventId: string) => ({
        jti: `jti-${eventId}`,
        scenarioId: "bank",
        clientId: "client-1",
        sub: "sub-1",
        eventId,
        eventKind: "revoked",
        validityStatus: "revoked",
        occurredAt: "2026-01-01T00:00:00.000Z",
        rawToken: "token",
      });

      vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
      await db.insert(schema.validityNotice).values(notice("first")).run();
      vi.setSystemTime(new Date("2026-01-01T00:00:05.000Z"));
      await db.insert(schema.validityNotice).values(notice("second")).run();

      const latest = await db
        .select()
        .from(schema.validityNotice)
        .orderBy(desc(schema.validityNotice.receivedAt))
        .limit(1)
        .get();

      expect(latest?.eventId).toBe("second");
      expect(latest?.receivedAt.toISOString()).toBe("2026-01-01T00:00:05.000Z");
    });
  });
});
