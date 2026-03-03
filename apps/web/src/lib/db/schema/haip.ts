import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { oauthClients } from "./oauth-provider";
import { defaultId } from "./utils";

export const haipPushedRequests = sqliteTable(
  "haip_pushed_request",
  {
    id: text("id").primaryKey().default(defaultId),
    requestId: text("request_id").notNull().unique(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClients.clientId, { onDelete: "cascade" }),
    requestParams: text("request_params").notNull(),
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
