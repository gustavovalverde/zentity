import { sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { users } from "./auth";
import { defaultId } from "./utils";

export const oauthClients = sqliteTable(
  "oauth_client",
  {
    id: text("id").primaryKey().default(defaultId),
    clientId: text("client_id").notNull(),
    clientSecret: text("client_secret"),
    disabled: integer("disabled", { mode: "boolean" }).notNull().default(false),
    skipConsent: integer("skip_consent", { mode: "boolean" }),
    enableEndSession: integer("enable_end_session", { mode: "boolean" }),
    scopes: text("scopes", { mode: "json" }),
    userId: text("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" }),
    name: text("name"),
    uri: text("uri"),
    icon: text("icon"),
    contacts: text("contacts", { mode: "json" }),
    tos: text("tos"),
    policy: text("policy"),
    softwareId: text("software_id"),
    softwareVersion: text("software_version"),
    softwareStatement: text("software_statement"),
    redirectUris: text("redirect_uris", { mode: "json" }).notNull(),
    postLogoutRedirectUris: text("post_logout_redirect_uris", { mode: "json" }),
    tokenEndpointAuthMethod: text("token_endpoint_auth_method"),
    grantTypes: text("grant_types", { mode: "json" }),
    responseTypes: text("response_types", { mode: "json" }),
    public: integer("public", { mode: "boolean" }),
    type: text("type"),
    referenceId: text("reference_id"),
    metadata: text("metadata", { mode: "json" }),
  },
  (table) => [
    uniqueIndex("oauth_client_client_id_unique").on(table.clientId),
    index("oauth_client_user_id_idx").on(table.userId),
  ]
);

export const oauthRefreshTokens = sqliteTable(
  "oauth_refresh_token",
  {
    id: text("id").primaryKey().default(defaultId),
    token: text("token").notNull(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClients.clientId, { onDelete: "cascade" }),
    sessionId: text("session_id"),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    referenceId: text("reference_id"),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").default(sql`(datetime('now'))`),
    revoked: text("revoked"),
    scopes: text("scopes", { mode: "json" }).notNull(),
  },
  (table) => [
    index("oauth_refresh_token_token_idx").on(table.token),
    index("oauth_refresh_token_client_id_idx").on(table.clientId),
    index("oauth_refresh_token_user_id_idx").on(table.userId),
  ]
);

export const oauthAccessTokens = sqliteTable(
  "oauth_access_token",
  {
    id: text("id").primaryKey().default(defaultId),
    token: text("token").notNull(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClients.clientId, { onDelete: "cascade" }),
    sessionId: text("session_id"),
    userId: text("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    referenceId: text("reference_id"),
    refreshId: text("refresh_id").references(() => oauthRefreshTokens.id, {
      onDelete: "set null",
    }),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").default(sql`(datetime('now'))`),
    scopes: text("scopes", { mode: "json" }).notNull(),
  },
  (table) => [
    uniqueIndex("oauth_access_token_token_unique").on(table.token),
    index("oauth_access_token_client_id_idx").on(table.clientId),
    index("oauth_access_token_user_id_idx").on(table.userId),
  ]
);

export const oauthConsents = sqliteTable(
  "oauth_consent",
  {
    id: text("id").primaryKey().default(defaultId),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClients.clientId, { onDelete: "cascade" }),
    userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
    referenceId: text("reference_id"),
    scopes: text("scopes", { mode: "json" }).notNull(),
    createdAt: text("created_at").default(sql`(datetime('now'))`),
    updatedAt: text("updated_at"),
  },
  (table) => [
    index("oauth_consent_client_id_idx").on(table.clientId),
    index("oauth_consent_user_id_idx").on(table.userId),
  ]
);

export type OauthClient = typeof oauthClients.$inferSelect;
export type NewOauthClient = typeof oauthClients.$inferInsert;
export type OauthRefreshToken = typeof oauthRefreshTokens.$inferSelect;
export type NewOauthRefreshToken = typeof oauthRefreshTokens.$inferInsert;
export type OauthAccessToken = typeof oauthAccessTokens.$inferSelect;
export type NewOauthAccessToken = typeof oauthAccessTokens.$inferInsert;
export type OauthConsent = typeof oauthConsents.$inferSelect;
export type NewOauthConsent = typeof oauthConsents.$inferInsert;
