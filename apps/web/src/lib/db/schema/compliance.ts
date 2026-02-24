import { sql } from "drizzle-orm";
import { index, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { oauthClients } from "./oauth-provider";
import { defaultId } from "./utils";

/**
 * RP Encryption Keys
 *
 * RPs (Relying Parties) register their ML-KEM-768 public encryption keys
 * for receiving compliance data. Zentity encrypts compliance data with
 * these keys so that only the RP can decrypt it.
 */
export const rpEncryptionKeys = sqliteTable(
  "rp_encryption_key",
  {
    id: text("id").primaryKey().default(defaultId),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClients.clientId, { onDelete: "cascade" }),
    // Base64-encoded ML-KEM-768 public key (1184 bytes raw)
    publicKey: text("public_key").notNull(),
    keyAlgorithm: text("key_algorithm", {
      enum: ["ml-kem-768"],
    })
      .notNull()
      .default("ml-kem-768"),
    // SHA-256 fingerprint of the public key for verification
    keyFingerprint: text("key_fingerprint").notNull(),
    intendedUse: text("intended_use")
      .notNull()
      .default("compliance_encryption"),
    status: text("status", {
      enum: ["active", "rotated", "revoked"],
    })
      .notNull()
      .default("active"),
    previousKeyId: text("previous_key_id"),
    rotatedAt: text("rotated_at"),
    createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
    updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
  },
  (table) => [
    index("idx_rp_encryption_keys_client").on(table.clientId),
    uniqueIndex("rp_encryption_key_client_active_unique")
      .on(table.clientId)
      .where(sql`status = 'active'`),
    index("idx_rp_encryption_keys_status").on(table.status),
  ]
);

export type RpEncryptionKey = typeof rpEncryptionKeys.$inferSelect;
export type NewRpEncryptionKey = typeof rpEncryptionKeys.$inferInsert;
