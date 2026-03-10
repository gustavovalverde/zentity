import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { users } from "./auth";
import { oauthClients } from "./oauth-provider";
import { defaultId } from "./utils";

/**
 * Durable approval records for CIBA identity release.
 *
 * PII is encrypted with a per-approval AES-GCM key. The key material
 * (release handle) is embedded in the access token — not stored here.
 * Only a SHA-256 hash of the handle is stored for lookup, ensuring
 * zero-knowledge at rest.
 */
export const approvals = sqliteTable(
  "approval",
  {
    id: text("id").primaryKey().default(defaultId),
    authReqId: text("auth_req_id"),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClients.clientId, { onDelete: "cascade" }),
    approvedScopes: text("approved_scopes").notNull(),
    authorizationDetails: text("authorization_details"),
    encryptedPii: text("encrypted_pii").notNull(),
    encryptionIv: text("encryption_iv").notNull(),
    releaseHandleHash: text("release_handle_hash").notNull().unique(),
    status: text("status").notNull().default("approved"),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    redeemedAt: integer("redeemed_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    index("approval_user_id_idx").on(table.userId),
    index("approval_client_id_idx").on(table.clientId),
    index("approval_release_handle_hash_idx").on(table.releaseHandleHash),
    index("approval_expires_at_idx").on(table.expiresAt),
  ]
);

export type Approval = typeof approvals.$inferSelect;
export type NewApproval = typeof approvals.$inferInsert;
