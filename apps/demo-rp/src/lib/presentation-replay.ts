import "server-only";

import type { ProofOfHumanReplayStore } from "@zentity/sdk/rp";
import { and, eq, gt, lte } from "drizzle-orm";

import { getDb } from "@/lib/db/connection";
import { presentationReplay } from "@/lib/db/schema";

/**
 * The merchant's replay store for PoH and DPoP proof `jti` values, in the
 * demo's database so every instance refuses a value another one accepted.
 */
export const presentationReplayStore: ProofOfHumanReplayStore = {
  async has(key) {
    const row = await getDb()
      .select({ key: presentationReplay.key })
      .from(presentationReplay)
      .where(
        and(
          eq(presentationReplay.key, key),
          gt(presentationReplay.expiresAt, new Date())
        )
      )
      .get();
    return row !== undefined;
  },
  async reserve({ key, expiresAt, now }) {
    const db = getDb();
    await db
      .delete(presentationReplay)
      .where(lte(presentationReplay.expiresAt, now))
      .run();
    const inserted = await db
      .insert(presentationReplay)
      .values({ key, expiresAt })
      .onConflictDoNothing()
      .returning({ key: presentationReplay.key });
    return inserted.length === 1;
  },
};
