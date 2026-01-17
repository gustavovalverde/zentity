import { sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { users } from "./auth";

export const recoveryConfigs = sqliteTable(
  "recovery_configs",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    threshold: integer("threshold").notNull(),
    totalGuardians: integer("total_guardians").notNull(),
    frostGroupPubkey: text("frost_group_pubkey").notNull(),
    frostPublicKeyPackage: text("frost_public_key_package").notNull(),
    frostCiphersuite: text("frost_ciphersuite").notNull(),
    status: text("status").notNull().default("active"),
    createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
    updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
  },
  (table) => [
    index("recovery_configs_user_id_idx").on(table.userId),
    index("recovery_configs_status_idx").on(table.status),
  ]
);

export const recoveryChallenges = sqliteTable(
  "recovery_challenges",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    recoveryConfigId: text("recovery_config_id")
      .notNull()
      .references(() => recoveryConfigs.id, { onDelete: "cascade" }),
    challengeNonce: text("challenge_nonce").notNull(),
    status: text("status").notNull().default("pending"),
    signaturesCollected: integer("signatures_collected").notNull().default(0),
    aggregatedSignature: text("aggregated_signature"),
    createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
    expiresAt: text("expires_at").notNull(),
    completedAt: text("completed_at"),
  },
  (table) => [
    index("recovery_challenges_user_id_idx").on(table.userId),
    index("recovery_challenges_config_id_idx").on(table.recoveryConfigId),
    index("recovery_challenges_status_idx").on(table.status),
  ]
);

export const recoveryGuardians = sqliteTable(
  "recovery_guardians",
  {
    id: text("id").primaryKey(),
    recoveryConfigId: text("recovery_config_id")
      .notNull()
      .references(() => recoveryConfigs.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    guardianType: text("guardian_type").notNull().default("email"),
    participantIndex: integer("participant_index").notNull(),
    status: text("status").notNull().default("active"),
    createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
    updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
  },
  (table) => [
    index("recovery_guardians_config_idx").on(table.recoveryConfigId),
    index("recovery_guardians_email_idx").on(table.email),
    index("recovery_guardians_participant_idx").on(table.participantIndex),
  ]
);

export const recoveryGuardianApprovals = sqliteTable(
  "recovery_guardian_approvals",
  {
    id: text("id").primaryKey(),
    challengeId: text("challenge_id")
      .notNull()
      .references(() => recoveryChallenges.id, { onDelete: "cascade" }),
    guardianId: text("guardian_id")
      .notNull()
      .references(() => recoveryGuardians.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    tokenExpiresAt: text("token_expires_at").notNull(),
    approvedAt: text("approved_at"),
    createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
  },
  (table) => [
    index("recovery_approvals_challenge_idx").on(table.challengeId),
    index("recovery_approvals_guardian_idx").on(table.guardianId),
    index("recovery_approvals_token_hash_idx").on(table.tokenHash),
  ]
);

export const recoverySecretWrappers = sqliteTable(
  "recovery_secret_wrappers",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    secretId: text("secret_id").notNull(),
    wrappedDek: text("wrapped_dek").notNull(),
    keyId: text("key_id").notNull(),
    createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
    updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
  },
  (table) => [
    index("recovery_wrappers_user_id_idx").on(table.userId),
    uniqueIndex("recovery_wrappers_secret_id_unique").on(table.secretId),
  ]
);

export const recoveryIdentifiers = sqliteTable(
  "recovery_identifiers",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    recoveryId: text("recovery_id").notNull(),
    createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
    updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
  },
  (table) => [
    index("recovery_identifiers_user_id_idx").on(table.userId),
    uniqueIndex("recovery_identifiers_recovery_id_unique").on(table.recoveryId),
  ]
);

export type RecoveryConfig = typeof recoveryConfigs.$inferSelect;
export type NewRecoveryConfig = typeof recoveryConfigs.$inferInsert;

export type RecoveryChallenge = typeof recoveryChallenges.$inferSelect;
export type NewRecoveryChallenge = typeof recoveryChallenges.$inferInsert;

export type RecoveryGuardian = typeof recoveryGuardians.$inferSelect;
export type NewRecoveryGuardian = typeof recoveryGuardians.$inferInsert;

export type RecoveryGuardianApproval =
  typeof recoveryGuardianApprovals.$inferSelect;
export type NewRecoveryGuardianApproval =
  typeof recoveryGuardianApprovals.$inferInsert;

export type RecoverySecretWrapper = typeof recoverySecretWrappers.$inferSelect;
export type NewRecoverySecretWrapper =
  typeof recoverySecretWrappers.$inferInsert;

export type RecoveryIdentifier = typeof recoveryIdentifiers.$inferSelect;
export type NewRecoveryIdentifier = typeof recoveryIdentifiers.$inferInsert;
