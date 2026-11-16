import type { GrantConstraint } from "../../agents/approval-evaluate";

import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { agentHosts, agentSessions } from "./agent";
import { authenticationContexts, defaultId, users } from "./auth";
import { oauthClients } from "./oauth-provider";

/**
 * A CIBA backchannel authentication request. The columns from `authReqId`
 * through `acrValues` are the `@better-auth/ciba` model; its adapter writes the
 * `string[]` fields `resources` and `acrValues` as JSON arrays, so raw readers
 * parse them with `parseStoredStringArray`. The rest are Zentity extensions
 * the plugin never reads: the verified agent session and attestation, and the
 * approving authentication context. The plugin deletes the row when it issues
 * the token or answers a denied or expired poll, so what was decided lives in
 * `ciba_approval`.
 */
export const cibaRequests = sqliteTable(
  "ciba_request",
  {
    id: text("id").primaryKey().default(defaultId),
    authReqId: text("auth_req_id").notNull().unique(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClients.clientId, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    scope: text("scope").notNull(),
    bindingMessage: text("binding_message"),
    resources: text("resources"),
    status: text("status", {
      enum: ["pending", "approved", "denied"],
    }).notNull(),
    clientNotificationEndpoint: text("client_notification_endpoint"),
    encryptedClientNotificationToken: text(
      "encrypted_client_notification_token"
    ),
    encryptedAuthReqId: text("encrypted_auth_req_id"),
    referenceId: text("reference_id"),
    authTime: integer("auth_time", { mode: "timestamp_ms" }),
    acr: text("acr"),
    amr: text("amr"),
    lastPolledAt: integer("last_polled_at", { mode: "timestamp_ms" }),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    authorizationDetails: text("authorization_details"),
    acrValues: text("acr_values"),
    agentSessionId: text("agent_session_id").references(
      () => agentSessions.id,
      {
        onDelete: "set null",
      }
    ),
    hostId: text("host_id").references(() => agentHosts.id, {
      onDelete: "set null",
    }),
    displayName: text("display_name"),
    runtime: text("runtime"),
    model: text("model"),
    version: text("version"),
    taskId: text("task_id"),
    taskHash: text("task_hash"),
    agentClaims: text("agent_claims"),
    assertionVerified: integer("assertion_verified", { mode: "boolean" }),
    attestationProvider: text("attestation_provider"),
    attestationTier: text("attestation_tier"),
    authContextId: text("auth_context_id").references(
      () => authenticationContexts.id,
      { onDelete: "set null" }
    ),
  },
  (table) => [
    index("ciba_request_client_id_idx").on(table.clientId),
    index("ciba_request_user_id_idx").on(table.userId),
    index("ciba_request_session_id_idx").on(table.agentSessionId),
    index("ciba_request_expires_at_idx").on(table.expiresAt),
  ]
);

export type CibaRequest = typeof cibaRequests.$inferSelect;
export type NewCibaRequest = typeof cibaRequests.$inferInsert;

/**
 * One decision on a CIBA request, written before the plugin can consume the
 * request and kept until the user is deleted. `referenceId` is the stored
 * `auth_req_id` hash every token of the approval references, and its unique
 * index lets only one decision win. The request fields are copies, because
 * the request row does not survive token issuance. The `token*` columns
 * describe the one access token the approval issued: a JWT's `jti` (null for
 * an opaque token, found by `referenceId`), its audience, and its issue time.
 */
export const cibaApprovals = sqliteTable(
  "ciba_approval",
  {
    id: text("id").primaryKey().default(defaultId),
    referenceId: text("reference_id").notNull().unique(),
    requestId: text("request_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // No foreign key, so the history survives the client's deletion.
    clientId: text("client_id").notNull(),
    scope: text("scope").notNull(),
    bindingMessage: text("binding_message"),
    authorizationDetails: text("authorization_details"),
    acrValues: text("acr_values"),
    decision: text("decision", { enum: ["approved", "denied"] }).notNull(),
    approvalMethod: text("approval_method", {
      enum: ["session", "user_verification", "capability_grant"],
    }),
    approvalChannel: text("approval_channel", {
      enum: ["push", "page", "email", "grant"],
    }).notNull(),
    capability: text("capability"),
    grantId: text("grant_id"),
    hostPolicyId: text("host_policy_id"),
    constraints: text("constraints", { mode: "json" }).$type<
      GrantConstraint[]
    >(),
    agentSessionId: text("agent_session_id").references(
      () => agentSessions.id,
      { onDelete: "set null" }
    ),
    hostId: text("host_id").references(() => agentHosts.id, {
      onDelete: "set null",
    }),
    attestationTier: text("attestation_tier"),
    attestationProvider: text("attestation_provider"),
    authContextId: text("auth_context_id").references(
      () => authenticationContexts.id,
      { onDelete: "set null" }
    ),
    requestedAt: integer("requested_at", { mode: "timestamp_ms" }).notNull(),
    decidedAt: integer("decided_at", { mode: "timestamp_ms" }).notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    tokenJti: text("token_jti").unique(),
    tokenAudience: text("token_audience"),
    tokenIssuedAt: integer("token_issued_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    index("ciba_approval_user_decided_idx").on(table.userId, table.decidedAt),
    index("ciba_approval_client_id_idx").on(table.clientId),
    index("ciba_approval_agent_session_id_idx").on(table.agentSessionId),
  ]
);

export type CibaApproval = typeof cibaApprovals.$inferSelect;
export type NewCibaApproval = typeof cibaApprovals.$inferInsert;
export type CibaApprovalMethod = NonNullable<CibaApproval["approvalMethod"]>;
export type CibaApprovalChannel = CibaApproval["approvalChannel"];

// ---------------------------------------------------------------------------
// Web Push subscriptions (used for CIBA approval notifications)
// ---------------------------------------------------------------------------

export const pushSubscriptions = sqliteTable(
  "push_subscription",
  {
    id: text("id").primaryKey().default(defaultId),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull().unique(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => [index("push_sub_user_id_idx").on(table.userId)]
);

export type PushSubscription = typeof pushSubscriptions.$inferSelect;
export type NewPushSubscription = typeof pushSubscriptions.$inferInsert;
