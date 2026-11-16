// @vitest-environment node
import { createClient } from "@libsql/client";
import {
  generateSQLiteDrizzleJson,
  generateSQLiteMigration,
} from "drizzle-kit/api";
import { drizzle } from "drizzle-orm/libsql";
import { beforeEach, describe, expect, it, vi } from "vitest";

// biome-ignore lint/performance/noNamespaceImport: drizzle-kit snapshots every exported table
import * as schema from "./db/schema";

const state = vi.hoisted(() => ({
  db: null as unknown,
}));

vi.mock("@/lib/db/connection", () => ({
  getDb: () => state.db,
}));

import { readZentitySubject, saveDcrClientId } from "./dcr";

async function signIn(userId: string, providerId: string, accountId: string) {
  const db = state.db as ReturnType<typeof drizzle<typeof schema>>;
  await db
    .insert(schema.user)
    .values({ id: userId, name: userId, email: `${userId}@example.com` })
    .onConflictDoNothing();
  await db.insert(schema.account).values({
    id: `${userId}-${providerId}`,
    accountId,
    providerId,
    userId,
    accessToken: "old-client-token",
  });
}

describe("saveDcrClientId", () => {
  beforeEach(async () => {
    const client = createClient({ url: ":memory:" });
    state.db = drizzle(client, { schema });
    const empty = await generateSQLiteDrizzleJson({});
    const current = await generateSQLiteDrizzleJson(schema);
    await client.batch(await generateSQLiteMigration(empty, current));
  });

  // R35: after the scenario's client is replaced, the next CIBA request asks
  // the signed-in user to sign in again instead of sending the old client's
  // subject and token.
  it("forgets sign-ins through a client it replaces", async () => {
    await saveDcrClientId("aether", "old-client", "a".repeat(64));
    await signIn("ada", "zentity-aether", "old-pairwise-sub");
    await signIn("ada", "zentity-bank", "bank-sub");

    await saveDcrClientId("aether", "new-client", "b".repeat(64));

    expect(await readZentitySubject("aether", "ada")).toBeNull();
    expect(await readZentitySubject("bank", "ada")).toBe("bank-sub");
  });

  it("keeps sign-ins when the client stays the same", async () => {
    await saveDcrClientId("aether", "same-client", "a".repeat(64));
    await signIn("ada", "zentity-aether", "pairwise-sub");

    await saveDcrClientId("aether", "same-client", "b".repeat(64));

    expect(await readZentitySubject("aether", "ada")).toBe("pairwise-sub");
  });
});
