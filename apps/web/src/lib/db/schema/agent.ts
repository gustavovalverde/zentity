import { sql } from "drizzle-orm";
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { defaultId, users } from "./auth";
import { oauthClients } from "./oauth-provider";

export const agentHosts = sqliteTable(
  "agent_host",
  {
    id: text("id").primaryKey().default(defaultId),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClients.clientId, { onDelete: "cascade" }),
    publicKey: text("public_key").notNull(),
    publicKeyThumbprint: text("public_key_thumbprint").notNull(),
    name: text("name").notNull(),
    status: text("status").notNull().default("active"),
    attestationProvider: text("attestation_provider"),
    attestationTier: text("attestation_tier").notNull().default("unverified"),
    attestationVerifiedAt: integer("attestation_verified_at", {
      mode: "timestamp_ms",
    }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => [
    uniqueIndex("agent_host_thumbprint_unique").on(table.publicKeyThumbprint),
    index("agent_host_user_id_idx").on(table.userId),
    index("agent_host_client_id_idx").on(table.clientId),
  ]
);

export const agentSessions = sqliteTable(
  "agent_session",
  {
    id: text("id").primaryKey().default(defaultId),
    hostId: text("host_id")
      .notNull()
      .references(() => agentHosts.id, { onDelete: "cascade" }),
    publicKey: text("public_key").notNull(),
    publicKeyThumbprint: text("public_key_thumbprint").notNull(),
    status: text("status").notNull().default("active"),
    displayName: text("display_name").notNull(),
    runtime: text("runtime"),
    model: text("model"),
    version: text("version"),
    idleTtlSec: integer("idle_ttl_sec").notNull().default(1800),
    maxLifetimeSec: integer("max_lifetime_sec").notNull().default(86_400),
    lastActiveAt: integer("last_seen_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => [
    uniqueIndex("agent_session_thumbprint_unique").on(
      table.publicKeyThumbprint
    ),
    index("agent_session_host_id_idx").on(table.hostId),
    index("agent_session_status_idx").on(table.status),
  ]
);

export const agentCapabilities = sqliteTable("agent_capability", {
  name: text("name").primaryKey(),
  description: text("description").notNull(),
  inputSchema: text("input_schema"),
  outputSchema: text("output_schema"),
  approvalStrength: text("approval_strength").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export const agentHostPolicies = sqliteTable(
  "agent_host_policy",
  {
    id: text("id").primaryKey().default(defaultId),
    hostId: text("host_id")
      .notNull()
      .references(() => agentHosts.id, { onDelete: "cascade" }),
    capabilityName: text("capability_name")
      .notNull()
      .references(() => agentCapabilities.name, { onDelete: "cascade" }),
    constraints: text("constraints_json"),
    dailyLimitCount: integer("daily_limit_count"),
    dailyLimitAmount: real("daily_limit_amount"),
    cooldownSec: integer("cooldown_sec"),
    source: text("source").notNull(),
    status: text("status").notNull().default("active"),
    grantedBy: text("granted_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    index("agent_host_policy_host_cap_idx").on(
      table.hostId,
      table.capabilityName
    ),
    index("agent_host_policy_status_idx").on(table.status),
  ]
);

export const agentSessionGrants = sqliteTable(
  "agent_session_grant",
  {
    id: text("id").primaryKey().default(defaultId),
    sessionId: text("session_id")
      .notNull()
      .references(() => agentSessions.id, { onDelete: "cascade" }),
    hostPolicyId: text("host_policy_id").references(
      () => agentHostPolicies.id,
      {
        onDelete: "set null",
      }
    ),
    capabilityName: text("capability_name")
      .notNull()
      .references(() => agentCapabilities.name, { onDelete: "cascade" }),
    constraints: text("constraints_json"),
    dailyLimitCount: integer("daily_limit_count"),
    dailyLimitAmount: real("daily_limit_amount"),
    cooldownSec: integer("cooldown_sec"),
    source: text("source").notNull(),
    status: text("status").notNull().default("pending"),
    grantedBy: text("granted_by").references(() => users.id, {
      onDelete: "set null",
    }),
    grantedAt: integer("granted_at", { mode: "timestamp_ms" }),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
    revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    index("agent_session_grant_session_cap_idx").on(
      table.sessionId,
      table.capabilityName
    ),
    index("agent_session_grant_status_idx").on(table.status),
    index("agent_session_grant_host_policy_idx").on(table.hostPolicyId),
  ]
);

export const agentTokenSnapshots = sqliteTable(
  "agent_token_snapshot",
  {
    tokenJti: text("token_jti").primaryKey(),
    authReqId: text("auth_req_id"),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClients.clientId, { onDelete: "cascade" }),
    hostId: text("host_id").references(() => agentHosts.id, {
      onDelete: "set null",
    }),
    agentSessionId: text("agent_session_id")
      .notNull()
      .references(() => agentSessions.id, { onDelete: "cascade" }),
    displayName: text("display_name"),
    runtime: text("runtime"),
    model: text("model"),
    version: text("version"),
    taskId: text("task_id"),
    taskHash: text("task_hash"),
    approvalMethod: text("approval_method"),
    approvedCapabilityName: text("approved_capability_name"),
    approvedConstraints: text("approved_constraints"),
    approvedGrantId: text("approved_grant_id"),
    approvedHostPolicyId: text("approved_host_policy_id"),
    approvalStrength: text("approval_strength"),
    attestationProvider: text("attestation_provider"),
    attestationTier: text("attestation_tier").notNull().default("unverified"),
    assertionVerified: integer("assertion_verified", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => [
    index("agent_token_snapshot_client_id_idx").on(table.clientId),
    index("agent_token_snapshot_session_id_idx").on(table.agentSessionId),
    index("agent_token_snapshot_auth_req_id_idx").on(table.authReqId),
  ]
);

export const usedAgentAssertionJtis = sqliteTable(
  "used_agent_assertion_jti",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => agentSessions.id, { onDelete: "cascade" }),
    jti: text("jti").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => [
    index("used_agent_assertion_jti_session_idx").on(table.sessionId),
    index("used_agent_assertion_jti_expires_at_idx").on(table.expiresAt),
  ]
);

export type AgentHost = typeof agentHosts.$inferSelect;
export type NewAgentHost = typeof agentHosts.$inferInsert;
export type AgentSession = typeof agentSessions.$inferSelect;
export type NewAgentSession = typeof agentSessions.$inferInsert;
export type AgentCapability = typeof agentCapabilities.$inferSelect;
export type AgentHostPolicy = typeof agentHostPolicies.$inferSelect;
export type AgentSessionGrant = typeof agentSessionGrants.$inferSelect;
export type AgentTokenSnapshot = typeof agentTokenSnapshots.$inferSelect;

// ── Capability usage tracking ────────────────────────────

export const capabilityUsageLedger = sqliteTable(
  "capability_usage_ledger",
  {
    id: text("id").primaryKey().default(defaultId),
    sessionId: text("session_id")
      .notNull()
      .references(() => agentSessions.id, { onDelete: "cascade" }),
    capabilityName: text("capability_name")
      .notNull()
      .references(() => agentCapabilities.name, { onDelete: "cascade" }),
    hostPolicyId: text("host_policy_id").references(
      () => agentHostPolicies.id,
      { onDelete: "set null" }
    ),
    grantId: text("session_grant_id").references(() => agentSessionGrants.id, {
      onDelete: "set null",
    }),
    amount: real("amount"),
    currency: text("currency"),
    metadata: text("metadata"),
    executedAt: integer("executed_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => [
    index("usage_ledger_session_cap_time_idx").on(
      table.sessionId,
      table.capabilityName,
      table.executedAt
    ),
    index("usage_ledger_host_policy_time_idx").on(
      table.hostPolicyId,
      table.executedAt
    ),
    index("usage_ledger_session_grant_time_idx").on(
      table.grantId,
      table.executedAt
    ),
  ]
);

export type CapabilityUsageEntry = typeof capabilityUsageLedger.$inferSelect;
