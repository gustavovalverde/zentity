import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const onboardingSessions = sqliteTable(
  "onboarding_sessions",
  {
    /** Random session ID - the primary key for session lookup */
    id: text("id").primaryKey(),
    /** User's email - nullable until entered, NOT unique (multiple sessions can exist) */
    email: text("email"),
    step: integer("step").notNull().default(1),
    encryptedPii: text("encrypted_pii"),
    documentHash: text("document_hash"),
    identityDraftId: text("identity_draft_id"),
    documentProcessed: integer("document_processed", { mode: "boolean" })
      .notNull()
      .default(false),
    livenessPassed: integer("liveness_passed", { mode: "boolean" })
      .notNull()
      .default(false),
    faceMatchPassed: integer("face_match_passed", { mode: "boolean" })
      .notNull()
      .default(false),
    keysSecured: integer("keys_secured", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: integer("created_at").notNull().default(sql`(unixepoch())`),
    updatedAt: integer("updated_at").notNull().default(sql`(unixepoch())`),
    expiresAt: integer("expires_at").notNull(),
  },
  (table) => ({
    expiresAtIdx: index("idx_onboarding_sessions_expires_at").on(
      table.expiresAt
    ),
    emailIdx: index("idx_onboarding_sessions_email").on(table.email),
  })
);

export type OnboardingSession = typeof onboardingSessions.$inferSelect;
export type NewOnboardingSession = typeof onboardingSessions.$inferInsert;
