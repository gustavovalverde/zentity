import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { users } from "./auth";
import { defaultId } from "./utils";

export const authenticationContexts = sqliteTable(
  "authentication_context",
  {
    id: text("id").primaryKey().default(defaultId),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sourceKind: text("source_kind").notNull(),
    loginMethod: text("login_method").notNull(),
    amr: text("amr").notNull(),
    authStrength: text("auth_strength").notNull(),
    authenticatedAt: integer("authenticated_at", {
      mode: "timestamp_ms",
    }).notNull(),
    sourceSessionId: text("source_session_id"),
    referenceType: text("reference_type"),
    referenceId: text("reference_id"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => [
    index("authentication_context_user_id_idx").on(table.userId),
    index("authentication_context_authenticated_at_idx").on(
      table.authenticatedAt
    ),
    index("authentication_context_source_session_id_idx").on(
      table.sourceSessionId
    ),
    index("authentication_context_reference_idx").on(
      table.referenceType,
      table.referenceId
    ),
  ]
);

export type AuthenticationContext = typeof authenticationContexts.$inferSelect;
export type NewAuthenticationContext =
  typeof authenticationContexts.$inferInsert;
