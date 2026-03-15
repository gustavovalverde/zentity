import { sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  unique,
} from "drizzle-orm/sqlite-core";

import { users } from "./auth";
import { oauthClients } from "./oauth-provider";
import { defaultId } from "./utils";

export const agentBoundaries = sqliteTable(
  "agent_boundary",
  {
    id: text("id").primaryKey().default(defaultId),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClients.clientId, { onDelete: "cascade" }),
    boundaryType: text("boundary_type").notNull(),
    config: text("config").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => [
    unique("agent_boundary_user_client_type_uniq").on(
      table.userId,
      table.clientId,
      table.boundaryType
    ),
    index("agent_boundary_user_id_idx").on(table.userId),
    index("agent_boundary_client_id_idx").on(table.clientId),
  ]
);

export type AgentBoundary = typeof agentBoundaries.$inferSelect;
export type NewAgentBoundary = typeof agentBoundaries.$inferInsert;
