// @vitest-environment node
import { createClient } from "@libsql/client";
import {
  generateSQLiteDrizzleJson,
  generateSQLiteMigration,
} from "drizzle-kit/api";
import { drizzle } from "drizzle-orm/libsql";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { presentationReplay } from "./db/schema";

const db = vi.hoisted(() => ({ current: undefined as unknown }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/connection", () => ({ getDb: () => db.current }));

import { presentationReplayStore } from "./presentation-replay";

const NOW = new Date("2026-01-01T00:00:00.000Z");
const LATER = new Date("2026-01-01T00:05:00.000Z");

describe("presentationReplayStore", () => {
  beforeEach(async () => {
    const client = createClient({ url: ":memory:" });
    const tables = { presentationReplay };
    await client.batch(
      await generateSQLiteMigration(
        await generateSQLiteDrizzleJson({}),
        await generateSQLiteDrizzleJson(tables)
      )
    );
    db.current = drizzle(client, { schema: tables });
  });

  // Two merchant instances share the database, so a value one of them
  // accepted is refused by the other.
  it("reserves a key once until it expires", async () => {
    const reservation = { key: "poh:jti-1", expiresAt: LATER, now: NOW };

    expect(await presentationReplayStore.reserve(reservation)).toBe(true);
    expect(await presentationReplayStore.reserve(reservation)).toBe(false);
    expect(
      await presentationReplayStore.reserve({
        ...reservation,
        expiresAt: new Date(LATER.getTime() + 60_000),
        now: LATER,
      })
    ).toBe(true);
  });

  it("reports a key as used only while it has not expired", async () => {
    await presentationReplayStore.reserve({
      key: "poh:jti-2",
      expiresAt: new Date(Date.now() + 60_000),
      now: new Date(),
    });
    await presentationReplayStore.reserve({
      key: "poh:jti-3",
      expiresAt: new Date(Date.now() - 1000),
      now: new Date(Date.now() - 2000),
    });

    expect(await presentationReplayStore.has("poh:jti-2")).toBe(true);
    expect(await presentationReplayStore.has("poh:jti-3")).toBe(false);
    expect(await presentationReplayStore.has("poh:unknown")).toBe(false);
  });
});
