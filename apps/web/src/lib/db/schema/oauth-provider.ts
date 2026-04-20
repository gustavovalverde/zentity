import { sql } from "drizzle-orm";
import {
  index,
  integer,
  // biome-ignore lint/suspicious/noDeprecatedImports: Drizzle uses this symbol for composite primary keys; this call site already uses the non-deprecated object form.
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { authenticationContexts, defaultId, users } from "./auth";

export const oauthClients = sqliteTable(
  "oauth_client",
  {
    id: text("id").primaryKey().default(defaultId),
    clientId: text("client_id").notNull(),
    clientSecret: text("client_secret"),
    disabled: integer("disabled", { mode: "boolean" }).notNull().default(false),
    skipConsent: integer("skip_consent", { mode: "boolean" }),
    enableEndSession: integer("enable_end_session", { mode: "boolean" }),
    scopes: text("scopes"),
    userId: text("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }),
    name: text("name"),
    uri: text("uri"),
    icon: text("icon"),
    contacts: text("contacts"),
    tos: text("tos"),
    policy: text("policy"),
    softwareId: text("software_id"),
    softwareVersion: text("software_version"),
    softwareStatement: text("software_statement"),
    redirectUris: text("redirect_uris").notNull(),
    postLogoutRedirectUris: text("post_logout_redirect_uris"),
    tokenEndpointAuthMethod: text("token_endpoint_auth_method"),
    grantTypes: text("grant_types"),
    responseTypes: text("response_types"),
    public: integer("public", { mode: "boolean" }),
    type: text("type"),
    subjectType: text("subject_type"),
    referenceId: text("reference_id"),
    metadata: text("metadata"),
    resource: text("resource"),
    metadataUrl: text("metadata_url"),
    metadataFetchedAt: integer("metadata_fetched_at", { mode: "timestamp_ms" }),
    trustLevel: integer("trust_level").notNull().default(0),
    firstParty: integer("first_party", { mode: "boolean" })
      .notNull()
      .default(false),
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
    authContextId: text("auth_context_id").references(
      () => authenticationContexts.id,
      { onDelete: "set null" }
    ),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    referenceId: text("reference_id"),
    resource: text("resource"),
    authTime: integer("auth_time", { mode: "timestamp_ms" }),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(
      sql`(unixepoch() * 1000)`
    ),
    revoked: integer("revoked", { mode: "timestamp_ms" }),
    scopes: text("scopes").notNull(),
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
    authContextId: text("auth_context_id").references(
      () => authenticationContexts.id,
      { onDelete: "set null" }
    ),
    userId: text("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    referenceId: text("reference_id"),
    refreshId: text("refresh_id").references(() => oauthRefreshTokens.id, {
      onDelete: "set null",
    }),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(
      sql`(unixepoch() * 1000)`
    ),
    dpopJkt: text("dpop_jkt"),
    scopes: text("scopes").notNull(),
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
    scopes: text("scopes").notNull(),
    scopeHmac: text("scope_hmac"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(
      sql`(unixepoch() * 1000)`
    ),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    index("oauth_consent_client_id_idx").on(table.clientId),
    index("oauth_consent_user_id_idx").on(table.userId),
  ]
);

export const oidcReleaseContexts = sqliteTable(
  "oidc_release_context",
  {
    releaseId: text("release_id").primaryKey(),
    flowType: text("flow_type").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClients.clientId, { onDelete: "cascade" }),
    claimsRequest: text("claims_request"),
    approvedIdentityScopes: text("approved_identity_scopes"),
    scopeHash: text("scope_hash"),
    expectsIdentityPayload: integer("expects_identity_payload", {
      mode: "boolean",
    })
      .notNull()
      .default(false),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    index("oidc_release_context_client_id_idx").on(table.clientId),
    index("oidc_release_context_user_id_idx").on(table.userId),
    index("oidc_release_context_expires_at_idx").on(table.expiresAt),
  ]
);

export const pairwiseSubjects = sqliteTable(
  "pairwise_subject",
  {
    sector: text("sector").notNull(),
    sub: text("sub").notNull(),
    subjectType: text("subject_type", {
      enum: ["user", "agent_session"],
    }).notNull(),
    subjectId: text("subject_id").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => [
    primaryKey({ columns: [table.sector, table.sub] }),
    index("pairwise_subject_subject_idx").on(
      table.subjectType,
      table.subjectId
    ),
  ]
);

export const oauthPendingDisclosures = sqliteTable(
  "oauth_pending_disclosure",
  {
    oauthRequestKey: text("oauth_request_key").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClients.clientId, { onDelete: "cascade" }),
    approvedIdentityScopes: text("approved_identity_scopes").notNull(),
    scopeHash: text("scope_hash").notNull(),
    intentJti: text("intent_jti").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => [
    index("oauth_pending_disclosure_client_id_idx").on(table.clientId),
    index("oauth_pending_disclosure_user_id_idx").on(table.userId),
    index("oauth_pending_disclosure_expires_at_idx").on(table.expiresAt),
    uniqueIndex("oauth_pending_disclosure_intent_jti_unique").on(
      table.intentJti
    ),
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
export type OidcReleaseContext = typeof oidcReleaseContexts.$inferSelect;
export type NewOidcReleaseContext = typeof oidcReleaseContexts.$inferInsert;
export type PairwiseSubject = typeof pairwiseSubjects.$inferSelect;
export type NewPairwiseSubject = typeof pairwiseSubjects.$inferInsert;
export type OauthPendingDisclosure =
  typeof oauthPendingDisclosures.$inferSelect;
export type NewOauthPendingDisclosure =
  typeof oauthPendingDisclosures.$inferInsert;

// ---------------------------------------------------------------------------
// JWKS (signing keys, JARM keys, at-rest encrypted private keys)
// ---------------------------------------------------------------------------

export const jwks = sqliteTable("jwks", {
  id: text("id").primaryKey().default(defaultId),
  publicKey: text("public_key").notNull(),
  privateKey: text("private_key").notNull(),
  alg: text("alg"),
  crv: text("crv"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
});

export type Jwk = typeof jwks.$inferSelect;
export type NewJwk = typeof jwks.$inferInsert;

// ---------------------------------------------------------------------------
// HAIP: pushed authorization requests + VP sessions
// ---------------------------------------------------------------------------

export const haipPushedRequests = sqliteTable(
  "haip_pushed_request",
  {
    id: text("id").primaryKey().default(defaultId),
    requestId: text("request_id").notNull().unique(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClients.clientId, { onDelete: "cascade" }),
    requestParams: text("request_params").notNull(),
    resource: text("resource"),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => [
    index("haip_pushed_request_client_id_idx").on(table.clientId),
    index("haip_pushed_request_expires_at_idx").on(table.expiresAt),
  ]
);

export const haipVpSessions = sqliteTable(
  "haip_vp_session",
  {
    id: text("id").primaryKey().default(defaultId),
    sessionId: text("session_id").notNull().unique(),
    nonce: text("nonce").notNull().unique(),
    state: text("state").notNull(),
    dcqlQuery: text("dcql_query").notNull(),
    responseUri: text("response_uri").notNull(),
    clientId: text("client_id"),
    clientIdScheme: text("client_id_scheme"),
    responseMode: text("response_mode").notNull().default("direct_post"),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => [index("haip_vp_session_expires_at_idx").on(table.expiresAt)]
);

export type HaipPushedRequest = typeof haipPushedRequests.$inferSelect;
export type NewHaipPushedRequest = typeof haipPushedRequests.$inferInsert;
export type HaipVpSession = typeof haipVpSessions.$inferSelect;
export type NewHaipVpSession = typeof haipVpSessions.$inferInsert;

// ---------------------------------------------------------------------------
// RP compliance encryption keys (ML-KEM-768)
// ---------------------------------------------------------------------------

export const rpEncryptionKeys = sqliteTable(
  "rp_encryption_key",
  {
    id: text("id").primaryKey().default(defaultId),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClients.clientId, { onDelete: "cascade" }),
    publicKey: text("public_key").notNull(),
    keyAlgorithm: text("key_algorithm", {
      enum: ["ml-kem-768"],
    })
      .notNull()
      .default("ml-kem-768"),
    keyFingerprint: text("key_fingerprint").notNull(),
    intendedUse: text("intended_use")
      .notNull()
      .default("compliance_encryption"),
    status: text("status", {
      enum: ["active", "rotated", "revoked"],
    })
      .notNull()
      .default("active"),
    previousKeyId: text("previous_key_id"),
    rotatedAt: text("rotated_at"),
    createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
    updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
  },
  (table) => [
    index("idx_rp_encryption_keys_client").on(table.clientId),
    uniqueIndex("rp_encryption_key_client_active_unique")
      .on(table.clientId)
      .where(sql`status = 'active'`),
    index("idx_rp_encryption_keys_status").on(table.status),
  ]
);

export type RpEncryptionKey = typeof rpEncryptionKeys.$inferSelect;
export type NewRpEncryptionKey = typeof rpEncryptionKeys.$inferInsert;

// ---------------------------------------------------------------------------
// First-party app auth challenge sessions (OPAQUE / EIP-712)
// ---------------------------------------------------------------------------

export const authChallengeSessions = sqliteTable(
  "auth_challenge_session",
  {
    id: text("id").primaryKey().default(defaultId),
    authSession: text("auth_session").notNull().unique(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClients.clientId, { onDelete: "cascade" }),
    userId: text("user_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    dpopJkt: text("dpop_jkt"),
    scope: text("scope").notNull(),
    claims: text("claims"),
    resource: text("resource"),
    codeChallenge: text("code_challenge"),
    codeChallengeMethod: text("code_challenge_method"),
    state: text("state", {
      enum: ["pending", "authenticated", "code_issued"],
    })
      .notNull()
      .default("pending"),
    challengeType: text("challenge_type", {
      enum: ["opaque", "eip712", "redirect_to_web"],
    }),
    resolvedAuthContextId: text("resolved_auth_context_id").references(
      () => authenticationContexts.id,
      { onDelete: "set null" }
    ),
    acrValues: text("acr_values"),
    opaqueServerState: text("opaque_server_state"),
    authorizationCode: text("authorization_code").unique(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => [
    index("auth_challenge_client_id_idx").on(table.clientId),
    index("auth_challenge_user_id_idx").on(table.userId),
    index("auth_challenge_expires_at_idx").on(table.expiresAt),
  ]
);

export type AuthChallengeSession = typeof authChallengeSessions.$inferSelect;
export type NewAuthChallengeSession = typeof authChallengeSessions.$inferInsert;
