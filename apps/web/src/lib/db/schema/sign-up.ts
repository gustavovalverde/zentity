import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Sign-up Sessions
 *
 * Minimal session tracking for the account creation wizard (RFC-0017).
 * Only stores wizard step and keys-secured state.
 *
 * Identity verification (document, liveness, face match) progress
 * is tracked in identity_verification_drafts, not here.
 */
export const signUpSessions = sqliteTable(
  "sign_up_sessions",
  {
    id: text("id").primaryKey(),
    step: integer("step").notNull().default(1),
    keysSecured: integer("keys_secured", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: integer("created_at").notNull().default(sql`(unixepoch())`),
    updatedAt: integer("updated_at").notNull().default(sql`(unixepoch())`),
    expiresAt: integer("expires_at").notNull(),
  },
  (table) => [index("idx_sign_up_sessions_expires_at").on(table.expiresAt)]
);

export type SignUpSession = typeof signUpSessions.$inferSelect;
export type NewSignUpSession = typeof signUpSessions.$inferInsert;
