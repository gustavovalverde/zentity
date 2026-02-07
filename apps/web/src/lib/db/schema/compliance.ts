import { sql } from "drizzle-orm";
import { index, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { oauthClients } from "./oauth-provider";
import { defaultId } from "./utils";

/**
 * RP Encryption Keys
 *
 * RPs (Relying Parties) register their public encryption keys for receiving
 * compliance data. Zentity encrypts compliance data with these keys so that
 * only the RP can decrypt it - Zentity cannot access the plaintext.
 *
 * Key algorithm options:
 * - x25519: Standard Curve25519 ECDH (current)
 * - x25519-ml-kem: Hybrid post-quantum (future-proof, when ML-KEM is standardized)
 */
export const rpEncryptionKeys = sqliteTable(
  "rp_encryption_key",
  {
    id: text("id").primaryKey().default(defaultId),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClients.clientId, { onDelete: "cascade" }),
    // Base64-encoded X25519 public key (32 bytes raw = 44 chars base64)
    publicKey: text("public_key").notNull(),
    keyAlgorithm: text("key_algorithm", {
      enum: ["x25519", "x25519-ml-kem"],
    })
      .notNull()
      .default("x25519"),
    // SHA-256 fingerprint of the public key for verification
    keyFingerprint: text("key_fingerprint").notNull(),
    // What this key is used for (compliance_encryption is the primary use)
    intendedUse: text("intended_use")
      .notNull()
      .default("compliance_encryption"),
    status: text("status", {
      enum: ["active", "rotated", "revoked"],
    })
      .notNull()
      .default("active"),
    // For key rotation tracking - link to the key this one replaced
    previousKeyId: text("previous_key_id"),
    rotatedAt: text("rotated_at"),
    createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
    updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
  },
  (table) => [
    index("idx_rp_encryption_keys_client").on(table.clientId),
    index("idx_rp_encryption_keys_client_algorithm").on(
      table.clientId,
      table.keyAlgorithm
    ),
    uniqueIndex("rp_encryption_key_client_algorithm_active_unique")
      .on(table.clientId, table.keyAlgorithm)
      .where(sql`status = 'active'`),
    index("idx_rp_encryption_keys_status").on(table.status),
  ]
);

export type RpEncryptionKey = typeof rpEncryptionKeys.$inferSelect;
export type NewRpEncryptionKey = typeof rpEncryptionKeys.$inferInsert;
