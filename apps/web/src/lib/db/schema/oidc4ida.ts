import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { users } from "./auth";
import { defaultId } from "./utils";

export const oidc4idaVerifiedClaims = sqliteTable(
  "oidc4ida_verified_claim",
  {
    id: text("id").primaryKey().default(defaultId),
    userId: text("user_id")
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: "cascade" }),
    verifiedClaims: text("verified_claims").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => [index("oidc4ida_verified_claim_user_id_idx").on(table.userId)]
);

export type Oidc4idaVerifiedClaim = typeof oidc4idaVerifiedClaims.$inferSelect;
export type NewOidc4idaVerifiedClaim =
  typeof oidc4idaVerifiedClaims.$inferInsert;
