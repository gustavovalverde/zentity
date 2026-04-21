import { sql } from "drizzle-orm";
import {
  foreignKey,
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { users } from "./auth";

export const validityStatusEnum = [
  "pending",
  "verified",
  "failed",
  "revoked",
  "stale",
] as const;

export type ValidityStatus = (typeof validityStatusEnum)[number];

export const verificationStatusEnum = [
  "pending",
  "verified",
  "failed",
  "revoked",
] as const;

export type VerificationStatus = (typeof verificationStatusEnum)[number];

export const verificationMethodEnum = ["ocr", "nfc_chip"] as const;

export type VerificationMethod = (typeof verificationMethodEnum)[number];

export const validityTransitionSourceEnum = [
  "product",
  "admin",
  "system",
  "chain",
] as const;

export type ValidityTransitionSource =
  (typeof validityTransitionSourceEnum)[number];

export const validityEventKindEnum = [
  "verified",
  "failed",
  "revoked",
  "stale",
  "superseded",
] as const;

export type ValidityEventKind = (typeof validityEventKindEnum)[number];

export const validityDeliveryTargetEnum = [
  "oidc4vci_credential_status",
  "ciba_request_cancellation",
  "backchannel_logout",
  "blockchain_attestation_revocation",
  "rp_validity_notice",
] as const;

export type ValidityDeliveryTarget =
  (typeof validityDeliveryTargetEnum)[number];

export const validityDeliveryStatusEnum = [
  "pending",
  "delivered",
  "retrying",
  "dead_letter",
] as const;

export type ValidityDeliveryStatus =
  (typeof validityDeliveryStatusEnum)[number];

export const fheStatusEnum = ["pending", "complete", "error"] as const;

export type FheStatus = (typeof fheStatusEnum)[number];

export const identityJobStatusEnum = [
  "queued",
  "running",
  "complete",
  "error",
] as const;

export type IdentityJobStatus = (typeof identityJobStatusEnum)[number];

export const screeningResultEnum = [
  "pending",
  "clear",
  "match",
  "error",
] as const;

export type ScreeningResult = (typeof screeningResultEnum)[number];

export const riskLevelEnum = ["low", "medium", "high", "critical"] as const;

export type RiskLevel = (typeof riskLevelEnum)[number];

export const identityBundles = sqliteTable(
  "identity_bundles",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    effectiveVerificationId: text("effective_verification_id").references(
      () => identityVerifications.id,
      { onDelete: "set null" }
    ),
    rpNullifierSeed: text("rp_nullifier_seed"),
    walletAddress: text("wallet_address"),
    validityStatus: text("validity_status", {
      enum: validityStatusEnum,
    }).default("pending"),
    policyVersion: text("policy_version"),
    issuerId: text("issuer_id"),
    attestationExpiresAt: text("attestation_expires_at"),
    fheKeyId: text("fhe_key_id"),
    fheStatus: text("fhe_status", {
      enum: fheStatusEnum,
    }),
    fheError: text("fhe_error"),

    // Compliance commitments (SHA256 hashes - never store plaintext)
    dobCommitment: text("dob_commitment"),
    addressCommitment: text("address_commitment"),
    addressCountryCode: integer("address_country_code"),

    // Screening results (PEP/Sanctions)
    pepScreeningResult: text("pep_screening_result", {
      enum: screeningResultEnum,
    }),
    pepScreenedAt: text("pep_screened_at"),
    pepScreeningProvider: text("pep_screening_provider"),
    sanctionsScreeningResult: text("sanctions_screening_result", {
      enum: screeningResultEnum,
    }),
    sanctionsScreenedAt: text("sanctions_screened_at"),
    sanctionsScreeningProvider: text("sanctions_screening_provider"),

    // Risk assessment
    riskLevel: text("risk_level", {
      enum: riskLevelEnum,
    }),
    riskScore: integer("risk_score"),
    riskAssessedAt: text("risk_assessed_at"),

    // Revocation metadata
    revokedAt: text("revoked_at"),
    revokedBy: text("revoked_by"),
    revokedReason: text("revoked_reason"),

    // Re-verification tracking
    lastVerifiedAt: text("last_verified_at"),
    verificationExpiresAt: text("verification_expires_at"),
    freshnessCheckedAt: text("freshness_checked_at"),
    verificationCount: integer("verification_count").default(0),

    createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
    updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
  },
  (table) => [
    index("idx_identity_bundles_validity_status").on(table.validityStatus),
  ]
);

export const identityValidityEvents = sqliteTable(
  "identity_validity_events",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    verificationId: text("verification_id").references(
      () => identityVerifications.id,
      { onDelete: "set null" }
    ),
    eventKind: text("event_kind", {
      enum: validityEventKindEnum,
    }).notNull(),
    validityStatus: text("validity_status", {
      enum: validityStatusEnum,
    }).notNull(),
    source: text("source", {
      enum: validityTransitionSourceEnum,
    }).notNull(),
    sourceEventId: text("source_event_id"),
    sourceNetwork: text("source_network"),
    sourceBlockNumber: integer("source_block_number"),
    triggeredBy: text("triggered_by"),
    reason: text("reason"),
    createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
  },
  (table) => [
    index("idx_identity_validity_events_user_created_at").on(
      table.userId,
      table.createdAt
    ),
    index("idx_identity_validity_events_verification_created_at").on(
      table.verificationId,
      table.createdAt
    ),
    uniqueIndex("identity_validity_events_source_event_unique").on(
      table.source,
      table.sourceNetwork,
      table.sourceEventId
    ),
  ]
);

export const identityValiditySourceCursors = sqliteTable(
  "identity_validity_source_cursors",
  {
    id: text("id").primaryKey(),
    source: text("source", {
      enum: validityTransitionSourceEnum,
    }).notNull(),
    network: text("network").notNull(),
    cursor: text("cursor"),
    lastSeenBlockNumber: integer("last_seen_block_number"),
    lastSeenBlockHash: text("last_seen_block_hash"),
    createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
    updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
  },
  (table) => [
    uniqueIndex("identity_validity_source_cursors_source_network_unique").on(
      table.source,
      table.network
    ),
  ]
);

export const identityValidityDeliveries = sqliteTable(
  "identity_validity_deliveries",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id")
      .notNull()
      .references(() => identityValidityEvents.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    target: text("target", {
      enum: validityDeliveryTargetEnum,
    }).notNull(),
    targetKey: text("target_key").notNull(),
    status: text("status", {
      enum: validityDeliveryStatusEnum,
    })
      .notNull()
      .default("pending"),
    attemptCount: integer("attempt_count").notNull().default(0),
    availableAt: text("available_at").notNull().default(sql`(datetime('now'))`),
    lastAttemptedAt: text("last_attempted_at"),
    deliveredAt: text("delivered_at"),
    lastError: text("last_error"),
    createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
    updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
  },
  (table) => [
    index("idx_identity_validity_deliveries_event").on(table.eventId),
    index("idx_identity_validity_deliveries_user_created_at").on(
      table.userId,
      table.createdAt
    ),
    index("idx_identity_validity_deliveries_status_available_at").on(
      table.status,
      table.availableAt
    ),
    uniqueIndex("identity_validity_deliveries_event_target_unique").on(
      table.eventId,
      table.target,
      table.targetKey
    ),
  ]
);

/**
 * Unified identity verification table — replaces identity_documents + passport_chip_verifications.
 * The `method` column discriminates between OCR and NFC verification paths.
 */
export const identityVerifications = sqliteTable(
  "identity_verifications",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    method: text("method", { enum: verificationMethodEnum }).notNull(),
    status: text("status", { enum: verificationStatusEnum })
      .notNull()
      .default("pending"),
    supersededAt: text("superseded_at"),
    supersededByVerificationId: text("superseded_by_verification_id"),
    documentType: text("document_type"),
    issuerCountry: text("issuer_country"),
    documentHash: text("document_hash"),
    dedupKey: text("dedup_key"),
    nameCommitment: text("name_commitment"),
    dobCommitment: text("dob_commitment"),
    nationalityCommitment: text("nationality_commitment"),
    addressCommitment: text("address_commitment"),
    addressCountryCode: integer("address_country_code"),
    confidenceScore: real("confidence_score"),
    livenessScore: real("liveness_score"),
    birthYearOffset: integer("birth_year_offset"),
    // ZKPassport nullifier (NFC only)
    uniqueIdentifier: text("unique_identifier"),
    verifiedAt: text("verified_at"),
    revokedAt: text("revoked_at"),
    revokedBy: text("revoked_by"),
    revokedReason: text("revoked_reason"),
    createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
    updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
  },
  (table) => [
    foreignKey({
      columns: [table.supersededByVerificationId],
      foreignColumns: [table.id],
      name: "identity_verifications_superseded_by_fk",
    }).onDelete("set null"),
    index("idx_identity_verifications_user_id").on(table.userId),
    index("idx_identity_verifications_doc_hash").on(table.documentHash),
    index("idx_identity_verifications_dedup_key").on(table.dedupKey),
    index("idx_identity_verifications_nullifier").on(table.uniqueIdentifier),
  ]
);

export const identityVerificationDrafts = sqliteTable(
  "identity_verification_drafts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    verificationId: text("verification_id").notNull(),
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
    documentHashField: text("document_hash_field"),
    ageClaimHash: text("age_claim_hash"),
    docValidityClaimHash: text("doc_validity_claim_hash"),
    nationalityClaimHash: text("nationality_claim_hash"),
    ocrIssues: text("ocr_issues"),
    antispoofScore: real("antispoof_score"),
    liveScore: real("live_score"),
    faceMatchConfidence: real("face_match_confidence"),

    // SHA-256 of the baseline frame captured during liveness completion.
    verifiedSelfieHash: text("verified_selfie_hash"),

    createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
    updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
  },
  (table) => [
    index("idx_identity_drafts_user").on(table.userId),
    index("idx_identity_drafts_verification").on(table.verificationId),
  ]
);

export const identityVerificationJobs = sqliteTable(
  "identity_verification_jobs",
  {
    id: text("id").primaryKey(),
    draftId: text("draft_id").notNull(),
    verificationId: text("verification_id"),
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
  (table) => [
    index("idx_identity_jobs_draft").on(table.draftId),
    index("idx_identity_jobs_status").on(table.status),
    index("idx_identity_jobs_user").on(table.userId),
  ]
);

export type IdentityBundle = typeof identityBundles.$inferSelect;
export type NewIdentityBundle = typeof identityBundles.$inferInsert;

export type IdentityValidityEvent = typeof identityValidityEvents.$inferSelect;
export type NewIdentityValidityEvent =
  typeof identityValidityEvents.$inferInsert;

export type IdentityValiditySourceCursor =
  typeof identityValiditySourceCursors.$inferSelect;
export type NewIdentityValiditySourceCursor =
  typeof identityValiditySourceCursors.$inferInsert;

export type IdentityValidityDelivery =
  typeof identityValidityDeliveries.$inferSelect;
export type NewIdentityValidityDelivery =
  typeof identityValidityDeliveries.$inferInsert;

export type IdentityVerification = typeof identityVerifications.$inferSelect;
export type NewIdentityVerification = typeof identityVerifications.$inferInsert;

export type IdentityVerificationDraft =
  typeof identityVerificationDrafts.$inferSelect;
export type NewIdentityVerificationDraft =
  typeof identityVerificationDrafts.$inferInsert;

export type IdentityVerificationJob =
  typeof identityVerificationJobs.$inferSelect;
export type NewIdentityVerificationJob =
  typeof identityVerificationJobs.$inferInsert;

// ── Attestation (on-chain identity proof) ────────────────

export const attestationEvidence = sqliteTable(
  "attestation_evidence",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    verificationId: text("verification_id").notNull(),
    policyVersion: text("policy_version"),
    policyHash: text("policy_hash"),
    proofSetHash: text("proof_set_hash"),
    consentReceipt: text("consent_receipt"),
    consentScope: text("consent_scope"),
    consentedAt: text("consented_at"),
    consentRpId: text("consent_rp_id"),
    createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
    updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
  },
  (table) => [
    index("idx_attestation_evidence_user_id").on(table.userId),
    index("idx_attestation_evidence_verification_id").on(table.verificationId),
    uniqueIndex("attestation_evidence_user_verification_unique").on(
      table.userId,
      table.verificationId
    ),
  ]
);

export type AttestationStatus =
  | "pending"
  | "submitted"
  | "confirmed"
  | "failed"
  | "revoked"
  | "revocation_pending";

export const blockchainAttestations = sqliteTable(
  "blockchain_attestations",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    walletAddress: text("wallet_address").notNull(),
    networkId: text("network_id").notNull(),
    chainId: integer("chain_id").notNull(),
    status: text("status", {
      enum: [
        "pending",
        "submitted",
        "confirmed",
        "failed",
        "revoked",
        "revocation_pending",
      ],
    }).default("pending"),
    txHash: text("tx_hash"),
    blockNumber: integer("block_number"),
    createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
    updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
    confirmedAt: text("confirmed_at"),
    revokedAt: text("revoked_at"),
    errorMessage: text("error_message"),
    retryCount: integer("retry_count").notNull().default(0),
  },
  (table) => [
    index("idx_attestations_user_id").on(table.userId),
    index("idx_attestations_network").on(table.networkId),
    index("idx_attestations_status").on(table.status),
    uniqueIndex("blockchain_attestations_user_network_unique").on(
      table.userId,
      table.networkId
    ),
  ]
);

export type AttestationEvidenceRecord = typeof attestationEvidence.$inferSelect;
export type NewAttestationEvidence = typeof attestationEvidence.$inferInsert;

export type BlockchainAttestation = typeof blockchainAttestations.$inferSelect;
export type NewBlockchainAttestation =
  typeof blockchainAttestations.$inferInsert;
