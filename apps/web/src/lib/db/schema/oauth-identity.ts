import { sql } from "drizzle-orm";
import {
  blob,
  index,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { users } from "./auth";
import { oauthClients } from "./oauth-provider";

/**
 * Server-encrypted identity data per RP relationship.
 *
 * When a user consents to share identity data with an RP, we:
 * 1. Decrypt the user's identity from their vault (user must be present)
 * 2. Re-encrypt with a server key bound to (userId, clientId)
 * 3. Store here for later userinfo responses (user doesn't need to be present)
 *
 * Each RP gets their own encrypted copy, which can be independently revoked.
 * The server key is derived from BETTER_AUTH_SECRET + context, so even Zentity
 * operators cannot decrypt without the secret.
 */
export const oauthIdentityData = sqliteTable(
  "oauth_identity_data",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClients.clientId, { onDelete: "cascade" }),
    // Server-encrypted blob containing identity fields (JSON inside AES-GCM)
    encryptedBlob: blob("encrypted_blob", { mode: "buffer" }).notNull(),
    // Which scopes were consented (determines what's in the blob)
    consentedScopes: text("consented_scopes", { mode: "json" })
      .$type<string[]>()
      .notNull(),
    // When identity was captured from user's vault
    capturedAt: text("captured_at").notNull(),
    // Optional expiry (RP can request time-limited access)
    expiresAt: text("expires_at"),
    createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
    updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
  },
  (table) => [
    uniqueIndex("idx_oauth_identity_user_client").on(
      table.userId,
      table.clientId
    ),
    index("idx_oauth_identity_expires").on(table.expiresAt),
  ]
);

export type OAuthIdentityData = typeof oauthIdentityData.$inferSelect;
export type NewOAuthIdentityData = typeof oauthIdentityData.$inferInsert;
