import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { defaultId } from "./utils";

export const jwks = sqliteTable("jwks", {
  id: text("id").primaryKey().default(defaultId),
  publicKey: text("public_key").notNull(),
  privateKey: text("private_key").notNull(),
  alg: text("alg"),
  crv: text("crv"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
});

export type Jwk = typeof jwks.$inferSelect;
export type NewJwk = typeof jwks.$inferInsert;
