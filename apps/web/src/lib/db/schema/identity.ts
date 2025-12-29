import { sql } from "drizzle-orm";
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

import { users } from "./auth";

export const identityBundleStatusEnum = [
  "pending",
  "verified",
  "failed",
] as const;

export type IdentityBundleStatus = (typeof identityBundleStatusEnum)[number];

export const identityDocumentStatusEnum = [
  "pending",
  "verified",
  "failed",
] as const;

export type IdentityDocumentStatus =
  (typeof identityDocumentStatusEnum)[number];

export const fheStatusEnum = ["pending", "complete", "error"] as const;

export type FheStatus = (typeof fheStatusEnum)[number];

export const identityBundles = sqliteTable(
  "identity_bundles",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    walletAddress: text("wallet_address"),
    status: text("status", {
      enum: identityBundleStatusEnum,
    }).default("pending"),
    policyVersion: text("policy_version"),
    issuerId: text("issuer_id"),
    attestationExpiresAt: text("attestation_expires_at"),
    fheKeyId: text("fhe_key_id"),
    fhePublicKey: text("fhe_public_key"),
    fheStatus: text("fhe_status", {
      enum: fheStatusEnum,
    }),
    fheError: text("fhe_error"),
    createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
    updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
  },
  (table) => ({
    statusIdx: index("idx_identity_bundles_status").on(table.status),
  }),
);

export const identityDocuments = sqliteTable(
  "identity_documents",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    documentType: text("document_type"),
    issuerCountry: text("issuer_country"),
    documentHash: text("document_hash").unique(),
    nameCommitment: text("name_commitment"),
    userSalt: text("user_salt"),
    birthYearOffset: integer("birth_year_offset"),
    firstNameEncrypted: text("first_name_encrypted"),
    verifiedAt: text("verified_at"),
    confidenceScore: real("confidence_score"),
    status: text("status", {
      enum: identityDocumentStatusEnum,
    })
      .notNull()
      .default("pending"),
    createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
    updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
  },
  (table) => ({
    userIdIdx: index("idx_identity_documents_user_id").on(table.userId),
    documentHashIdx: index("idx_identity_documents_doc_hash").on(
      table.documentHash,
    ),
  }),
);

export type IdentityBundle = typeof identityBundles.$inferSelect;
export type NewIdentityBundle = typeof identityBundles.$inferInsert;

export type IdentityDocument = typeof identityDocuments.$inferSelect;
export type NewIdentityDocument = typeof identityDocuments.$inferInsert;
