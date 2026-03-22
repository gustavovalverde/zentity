import { sql } from "drizzle-orm";
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

import {
  agentCapabilities,
  agentHostPolicies,
  agentSessionGrants,
  agentSessions,
} from "./agent";
import { defaultId } from "./utils";

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
      {
        onDelete: "set null",
      }
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
