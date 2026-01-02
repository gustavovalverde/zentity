import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { users } from "./auth";

export const rpAuthorizationCodes = sqliteTable(
  "rp_authorization_codes",
  {
    code: text("code").primaryKey(),
    clientId: text("client_id").notNull(),
    redirectUri: text("redirect_uri").notNull(),
    state: text("state"),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: integer("created_at").notNull().default(sql`(unixepoch())`),
    expiresAt: integer("expires_at").notNull(),
    usedAt: integer("used_at"),
  },
  (table) => ({
    expiresAtIdx: index("idx_rp_authorization_codes_expires_at").on(
      table.expiresAt
    ),
    userIdIdx: index("idx_rp_authorization_codes_user_id").on(table.userId),
  })
);

export type RpAuthorizationCode = typeof rpAuthorizationCodes.$inferSelect;
export type NewRpAuthorizationCode = typeof rpAuthorizationCodes.$inferInsert;
