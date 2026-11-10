import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { agentHosts, agentSessions } from "./agent";
import { authenticationContexts, defaultId, users } from "./auth";
import { oauthClients } from "./oauth-provider";

/**
 * A CIBA backchannel authentication request. The columns from `authReqId`
 * through `createdAt` are the `@better-auth/ciba` model; the rest are Zentity
 * extensions the plugin never reads: the RAR and `acr_values` the client sent
 * (the plugin does not model them), the verified agent session and attestation,
 * the capability grant that approved it, and the approving authentication
 * context.
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
    pairwiseActSub: text("pairwise_act_sub"),
    approvedCapabilityName: text("approved_capability_name"),
    approvedConstraints: text("approved_constraints"),
    approvedGrantId: text("approved_grant_id"),
    approvedHostPolicyId: text("approved_host_policy_id"),
    approvalStrength: text("approval_strength"),
    approvalMethod: text("approval_method"),
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
