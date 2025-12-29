import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { users } from "./auth";

export const zkProofs = sqliteTable(
  "zk_proofs",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    documentId: text("document_id"),
    proofType: text("proof_type").notNull(),
    proofHash: text("proof_hash").notNull(),
    proofPayload: text("proof_payload"),
    publicInputs: text("public_inputs"),
    isOver18: integer("is_over_18", { mode: "boolean" }),
    generationTimeMs: integer("generation_time_ms"),
    nonce: text("nonce"),
    policyVersion: text("policy_version"),
    circuitType: text("circuit_type"),
    noirVersion: text("noir_version"),
    circuitHash: text("circuit_hash"),
    bbVersion: text("bb_version"),
    verified: integer("verified", { mode: "boolean" }).default(false),
    createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
  },
  (table) => ({
    userIdIdx: index("idx_zk_proofs_user_id").on(table.userId),
    typeIdx: index("idx_zk_proofs_type").on(table.proofType),
    documentIdx: index("idx_zk_proofs_document_id").on(table.documentId),
    proofHashIdx: index("idx_zk_proofs_hash").on(table.proofHash),
  }),
);

export const encryptedAttributes = sqliteTable(
  "encrypted_attributes",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    source: text("source").notNull(),
    attributeType: text("attribute_type").notNull(),
    ciphertext: text("ciphertext").notNull(),
    keyId: text("key_id"),
    encryptionTimeMs: integer("encryption_time_ms"),
    createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
  },
  (table) => ({
    userIdIdx: index("idx_encrypted_attributes_user_id").on(table.userId),
    typeIdx: index("idx_encrypted_attributes_type").on(table.attributeType),
  }),
);

export const signedClaims = sqliteTable(
  "signed_claims",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    documentId: text("document_id"),
    claimType: text("claim_type").notNull(),
    claimPayload: text("claim_payload").notNull(),
    signature: text("signature").notNull(),
    issuedAt: text("issued_at").notNull(),
    createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
  },
  (table) => ({
    userIdIdx: index("idx_signed_claims_user_id").on(table.userId),
    typeIdx: index("idx_signed_claims_type").on(table.claimType),
  }),
);

export const zkChallenges = sqliteTable(
  "zk_challenges",
  {
    nonce: text("nonce").primaryKey(),
    circuitType: text("circuit_type").notNull(),
    userId: text("user_id"),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
  },
  (table) => ({
    expiresAtIdx: index("idx_zk_challenges_expires_at").on(table.expiresAt),
  }),
);

export type ZkProofRecord = typeof zkProofs.$inferSelect;
export type NewZkProofRecord = typeof zkProofs.$inferInsert;

export type EncryptedAttributeRecord = typeof encryptedAttributes.$inferSelect;
export type NewEncryptedAttribute = typeof encryptedAttributes.$inferInsert;

export type SignedClaimRecord = typeof signedClaims.$inferSelect;
export type NewSignedClaim = typeof signedClaims.$inferInsert;

export type ZkChallenge = typeof zkChallenges.$inferSelect;
export type NewZkChallenge = typeof zkChallenges.$inferInsert;
