import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { defaultId, users } from "./auth";

// ---------------------------------------------------------------------------
// OIDC4IDA: verified claims (RP-disclosable identity attributes)
// ---------------------------------------------------------------------------

export const oidc4idaVerifiedClaims = sqliteTable(
  "oidc4ida_verified_claim",
  {
    id: text("id").primaryKey().default(defaultId),
    userId: text("user_id")
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: "cascade" }),
    verifiedClaims: text("verified_claims").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => [index("oidc4ida_verified_claim_user_id_idx").on(table.userId)]
);

export type Oidc4idaVerifiedClaim = typeof oidc4idaVerifiedClaims.$inferSelect;
export type NewOidc4idaVerifiedClaim =
  typeof oidc4idaVerifiedClaims.$inferInsert;

// ---------------------------------------------------------------------------
// OIDC4VCI: credential offers + issued credentials (wallet flow)
// ---------------------------------------------------------------------------

export const oidc4vciOffers = sqliteTable(
  "oidc4vci_offer",
  {
    id: text("id").primaryKey().default(defaultId),
    walletClientId: text("wallet_client_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    credentialConfigurationId: text("credential_configuration_id").notNull(),
    preAuthorizedCodeEncrypted: text("pre_authorized_code_encrypted").notNull(),
    txCodeHash: text("tx_code_hash"),
    txCodeInputMode: text("tx_code_input_mode"),
    txCodeLength: integer("tx_code_length"),
    issuerState: text("issuer_state"),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => [
    index("oidc4vci_offer_user_id_idx").on(table.userId),
    index("oidc4vci_offer_expires_at_idx").on(table.expiresAt),
  ]
);

export const oidc4vciIssuedCredentials = sqliteTable(
  "oidc4vci_issued_credential",
  {
    id: text("id").primaryKey().default(defaultId),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    credentialConfigurationId: text("credential_configuration_id").notNull(),
    format: text("format").notNull(),
    statusListId: text("status_list_id").notNull(),
    statusListIndex: integer("status_list_index").notNull(),
    status: integer("status").notNull().default(0),
    revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
    credential: text("credential").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => [
    index("oidc4vci_issued_credential_user_id_idx").on(table.userId),
    index("oidc4vci_issued_credential_status_list_id_idx").on(
      table.statusListId
    ),
  ]
);

export type Oidc4vciOffer = typeof oidc4vciOffers.$inferSelect;
export type NewOidc4vciOffer = typeof oidc4vciOffers.$inferInsert;
export type Oidc4vciIssuedCredential =
  typeof oidc4vciIssuedCredentials.$inferSelect;
export type NewOidc4vciIssuedCredential =
  typeof oidc4vciIssuedCredentials.$inferInsert;
