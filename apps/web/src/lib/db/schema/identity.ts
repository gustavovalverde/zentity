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

export const identityJobStatusEnum = [
  "queued",
  "running",
  "complete",
  "error",
] as const;

export type IdentityJobStatus = (typeof identityJobStatusEnum)[number];

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
    fheStatus: text("fhe_status", {
      enum: fheStatusEnum,
    }),
    fheError: text("fhe_error"),
    createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
    updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
  },
  (table) => ({
    statusIdx: index("idx_identity_bundles_status").on(table.status),
  })
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
      table.documentHash
    ),
  })
);

export const identityVerificationDrafts = sqliteTable(
  "identity_verification_drafts",
  {
    id: text("id").primaryKey(),
    onboardingSessionId: text("onboarding_session_id").notNull(),
    userId: text("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    documentId: text("document_id").notNull(),
    documentProcessed: integer("document_processed", { mode: "boolean" })
      .notNull()
      .default(false),
    isDocumentValid: integer("is_document_valid", { mode: "boolean" })
      .notNull()
      .default(false),
    isDuplicateDocument: integer("is_duplicate_document", {
      mode: "boolean",
    })
      .notNull()
      .default(false),
    documentType: text("document_type"),
    issuerCountry: text("issuer_country"),
    documentHash: text("document_hash"),
    documentHashField: text("document_hash_field"),
    nameCommitment: text("name_commitment"),
    ageClaimHash: text("age_claim_hash"),
    docValidityClaimHash: text("doc_validity_claim_hash"),
    nationalityClaimHash: text("nationality_claim_hash"),
    confidenceScore: real("confidence_score"),
    ocrIssues: text("ocr_issues"),
    antispoofScore: real("antispoof_score"),
    liveScore: real("live_score"),
    livenessPassed: integer("liveness_passed", { mode: "boolean" }),
    faceMatchConfidence: real("face_match_confidence"),
    faceMatchPassed: integer("face_match_passed", { mode: "boolean" }),
    createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
    updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
  },
  (table) => ({
    sessionIdx: index("idx_identity_drafts_session").on(
      table.onboardingSessionId
    ),
    userIdx: index("idx_identity_drafts_user").on(table.userId),
    documentIdx: index("idx_identity_drafts_document").on(table.documentId),
  })
);

export const identityVerificationJobs = sqliteTable(
  "identity_verification_jobs",
  {
    id: text("id").primaryKey(),
    draftId: text("draft_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: text("status", { enum: identityJobStatusEnum })
      .notNull()
      .default("queued"),
    fheKeyId: text("fhe_key_id"),
    result: text("result"),
    error: text("error"),
    attempts: integer("attempts").notNull().default(0),
    startedAt: text("started_at"),
    finishedAt: text("finished_at"),
    createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
    updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
  },
  (table) => ({
    draftIdx: index("idx_identity_jobs_draft").on(table.draftId),
    statusIdx: index("idx_identity_jobs_status").on(table.status),
    userIdx: index("idx_identity_jobs_user").on(table.userId),
  })
);

export type IdentityBundle = typeof identityBundles.$inferSelect;
export type NewIdentityBundle = typeof identityBundles.$inferInsert;

export type IdentityDocument = typeof identityDocuments.$inferSelect;
export type NewIdentityDocument = typeof identityDocuments.$inferInsert;

export type IdentityVerificationDraft =
  typeof identityVerificationDrafts.$inferSelect;
export type NewIdentityVerificationDraft =
  typeof identityVerificationDrafts.$inferInsert;

export type IdentityVerificationJob =
  typeof identityVerificationJobs.$inferSelect;
export type NewIdentityVerificationJob =
  typeof identityVerificationJobs.$inferInsert;
