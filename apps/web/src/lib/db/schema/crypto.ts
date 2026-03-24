import { sql } from "drizzle-orm";
import {
  blob,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { users } from "./auth";

export const proofSessions = sqliteTable(
  "proof_sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    verificationId: text("verification_id").notNull(),
    msgSender: text("msg_sender").notNull(),
    audience: text("audience").notNull(),
    policyVersion: text("policy_version").notNull(),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
    closedAt: integer("closed_at"),
  },
  (table) => [
    index("idx_proof_sessions_user_id").on(table.userId),
    index("idx_proof_sessions_verification_id").on(table.verificationId),
    index("idx_proof_sessions_expires_at").on(table.expiresAt),
  ]
);

export const proofArtifacts = sqliteTable(
  "proof_artifacts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    verificationId: text("verification_id"),
    proofSessionId: text("proof_session_id").references(
      () => proofSessions.id,
      {
        onDelete: "cascade",
      }
    ),
    proofSystem: text("proof_system").notNull(),
    proofType: text("proof_type").notNull(),
    proofHash: text("proof_hash").notNull(),
    proofPayload: text("proof_payload"),
    publicInputs: text("public_inputs"),
    verified: integer("verified", { mode: "boolean" }).default(false),
    generationTimeMs: integer("generation_time_ms"),
    nonce: text("nonce"),
    policyVersion: text("policy_version"),
    metadata: text("metadata"),
    createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
  },
  (table) => [
    index("idx_proof_artifacts_user_id").on(table.userId),
    index("idx_proof_artifacts_session_id").on(table.proofSessionId),
    index("idx_proof_artifacts_type").on(table.proofType),
    index("idx_proof_artifacts_verification_id").on(table.verificationId),
    index("idx_proof_artifacts_hash").on(table.proofHash),
    index("idx_proof_artifacts_system").on(table.proofSystem),
  ]
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
    ciphertext: blob("ciphertext", { mode: "buffer" }).notNull(),
    ciphertextHash: text("ciphertext_hash").notNull().default(""),
    keyId: text("key_id"),
    encryptionTimeMs: integer("encryption_time_ms"),
    createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
  },
  (table) => [
    index("idx_encrypted_attributes_user_id").on(table.userId),
    index("idx_encrypted_attributes_type").on(table.attributeType),
    uniqueIndex("uq_encrypted_attributes_user_type").on(
      table.userId,
      table.attributeType
    ),
  ]
);

export const signedClaims = sqliteTable(
  "signed_claims",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    verificationId: text("verification_id"),
    claimType: text("claim_type").notNull(),
    claimPayload: text("claim_payload").notNull(),
    signature: text("signature").notNull(),
    issuedAt: text("issued_at").notNull(),
    createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
  },
  (table) => [
    index("idx_signed_claims_user_id").on(table.userId),
    index("idx_signed_claims_type").on(table.claimType),
  ]
);

export const zkChallenges = sqliteTable(
  "zk_challenges",
  {
    nonce: text("nonce").primaryKey(),
    circuitType: text("circuit_type").notNull(),
    proofSessionId: text("proof_session_id").references(
      () => proofSessions.id,
      {
        onDelete: "cascade",
      }
    ),
    userId: text("user_id"),
    msgSender: text("msg_sender"),
    audience: text("audience"),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
  },
  (table) => [
    index("idx_zk_challenges_expires_at").on(table.expiresAt),
    index("idx_zk_challenges_session_id").on(table.proofSessionId),
    index("idx_zk_challenges_msg_sender").on(table.msgSender),
    index("idx_zk_challenges_audience").on(table.audience),
  ]
);

export const verificationChecks = sqliteTable(
  "verification_checks",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    verificationId: text("verification_id").notNull(),
    checkType: text("check_type").notNull(),
    passed: integer("passed", { mode: "boolean" }).notNull(),
    source: text("source").notNull(),
    evidenceRef: text("evidence_ref"),
    metadata: text("metadata"),
    createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
    updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
  },
  (table) => [
    uniqueIndex("uq_verification_checks_verification_check").on(
      table.verificationId,
      table.checkType
    ),
    index("idx_verification_checks_user_id").on(table.userId),
    index("idx_verification_checks_verification_id").on(table.verificationId),
  ]
);

export const usedIntentJtis = sqliteTable(
  "used_intent_jtis",
  {
    jti: text("jti").primaryKey(),
    userId: text("user_id").notNull(),
    expiresAt: integer("expires_at").notNull(),
  },
  (table) => [index("idx_used_intent_jtis_expires_at").on(table.expiresAt)]
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
    createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
    updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
  },
  (table) => [
    index("idx_encrypted_secrets_user_id").on(table.userId),
    index("idx_encrypted_secrets_type").on(table.secretType),
    uniqueIndex("encrypted_secrets_user_secret_type_unique").on(
      table.userId,
      table.secretType
    ),
  ]
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
    prfSalt: text("prf_salt"),
    kekSource: text("kek_source").notNull().default("prf"),
    baseCommitment: text("base_commitment"),
    createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
    updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
  },
  (table) => [
    index("idx_secret_wrappers_user_id").on(table.userId),
    index("idx_secret_wrappers_credential_id").on(table.credentialId),
    index("idx_secret_wrappers_kek_source").on(table.kekSource),
    uniqueIndex("secret_wrappers_secret_credential_unique").on(
      table.secretId,
      table.credentialId
    ),
  ]
);

export type ProofArtifactRecord = typeof proofArtifacts.$inferSelect;
export type NewProofArtifact = typeof proofArtifacts.$inferInsert;

export type ProofSessionRecord = typeof proofSessions.$inferSelect;
export type NewProofSession = typeof proofSessions.$inferInsert;

export type VerificationCheckRecord = typeof verificationChecks.$inferSelect;
export type NewVerificationCheck = typeof verificationChecks.$inferInsert;

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
