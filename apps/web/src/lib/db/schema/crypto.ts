import { sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

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
  })
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
  })
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
  })
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
  })
);

export const encryptedSecrets = sqliteTable(
  "encrypted_secrets",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    secretType: text("secret_type").notNull(),
    encryptedBlob: text("encrypted_blob").notNull(),
    blobRef: text("blob_ref"),
    blobHash: text("blob_hash"),
    blobSize: integer("blob_size"),
    metadata: text("metadata"),
    version: text("version").notNull(),
    createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
    updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
  },
  (table) => ({
    userIdIdx: index("idx_encrypted_secrets_user_id").on(table.userId),
    typeIdx: index("idx_encrypted_secrets_type").on(table.secretType),
    userTypeUnique: uniqueIndex("encrypted_secrets_user_secret_type_unique").on(
      table.userId,
      table.secretType
    ),
  })
);

export const secretWrappers = sqliteTable(
  "secret_wrappers",
  {
    id: text("id").primaryKey(),
    secretId: text("secret_id")
      .notNull()
      .references(() => encryptedSecrets.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    credentialId: text("credential_id").notNull(),
    wrappedDek: text("wrapped_dek").notNull(),
    prfSalt: text("prf_salt").notNull(),
    kekVersion: text("kek_version").notNull(),
    createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
    updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
  },
  (table) => ({
    userIdIdx: index("idx_secret_wrappers_user_id").on(table.userId),
    credentialIdx: index("idx_secret_wrappers_credential_id").on(
      table.credentialId
    ),
    secretCredentialUnique: uniqueIndex(
      "secret_wrappers_secret_credential_unique"
    ).on(table.secretId, table.credentialId),
  })
);

export type ZkProofRecord = typeof zkProofs.$inferSelect;
export type NewZkProofRecord = typeof zkProofs.$inferInsert;

export type EncryptedAttributeRecord = typeof encryptedAttributes.$inferSelect;
export type NewEncryptedAttribute = typeof encryptedAttributes.$inferInsert;

export type SignedClaimRecord = typeof signedClaims.$inferSelect;
export type NewSignedClaim = typeof signedClaims.$inferInsert;

export type ZkChallenge = typeof zkChallenges.$inferSelect;
export type NewZkChallenge = typeof zkChallenges.$inferInsert;

export type EncryptedSecretRecord = typeof encryptedSecrets.$inferSelect;
export type NewEncryptedSecret = typeof encryptedSecrets.$inferInsert;

export type SecretWrapperRecord = typeof secretWrappers.$inferSelect;
export type NewSecretWrapper = typeof secretWrappers.$inferInsert;
