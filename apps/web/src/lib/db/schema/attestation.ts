import { sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { users } from "./auth";

export const attestationEvidence = sqliteTable(
  "attestation_evidence",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    documentId: text("document_id").notNull(),
    policyVersion: text("policy_version"),
    policyHash: text("policy_hash"),
    proofSetHash: text("proof_set_hash"),
    createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
    updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
  },
  (table) => ({
    userIdIdx: index("idx_attestation_evidence_user_id").on(table.userId),
    documentIdIdx: index("idx_attestation_evidence_document_id").on(
      table.documentId,
    ),
    userDocumentUnique: uniqueIndex(
      "attestation_evidence_user_document_unique",
    ).on(table.userId, table.documentId),
  }),
);

export type AttestationStatus =
  | "pending"
  | "submitted"
  | "confirmed"
  | "failed";

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
      enum: ["pending", "submitted", "confirmed", "failed"],
    }).default("pending"),
    txHash: text("tx_hash"),
    blockNumber: integer("block_number"),
    createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
    updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
    confirmedAt: text("confirmed_at"),
    errorMessage: text("error_message"),
    retryCount: integer("retry_count").notNull().default(0),
  },
  (table) => ({
    userIdIdx: index("idx_attestations_user_id").on(table.userId),
    networkIdx: index("idx_attestations_network").on(table.networkId),
    statusIdx: index("idx_attestations_status").on(table.status),
    userNetworkUnique: uniqueIndex(
      "blockchain_attestations_user_network_unique",
    ).on(table.userId, table.networkId),
  }),
);

export type AttestationEvidenceRecord = typeof attestationEvidence.$inferSelect;
export type NewAttestationEvidence = typeof attestationEvidence.$inferInsert;

export type BlockchainAttestation = typeof blockchainAttestations.$inferSelect;
export type NewBlockchainAttestation =
  typeof blockchainAttestations.$inferInsert;
