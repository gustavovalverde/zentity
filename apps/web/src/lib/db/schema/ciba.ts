import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { users } from "./auth";
import { oauthClients } from "./oauth-provider";
import { defaultId } from "./utils";

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
    authorizationDetails: text("authorization_details"),
    acrValues: text("acr_values"),
    resource: text("resource"),
    status: text("status").notNull(),
    deliveryMode: text("delivery_mode").notNull().default("poll"),
    clientNotificationToken: text("client_notification_token"),
    clientNotificationEndpoint: text("client_notification_endpoint"),
    pollingInterval: integer("polling_interval").notNull().default(5),
    approvalMethod: text("approval_method"),
    lastPolledAt: integer("last_polled_at"),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => [
    index("ciba_request_client_id_idx").on(table.clientId),
    index("ciba_request_user_id_idx").on(table.userId),
    index("ciba_request_expires_at_idx").on(table.expiresAt),
  ]
);

export type CibaRequest = typeof cibaRequests.$inferSelect;
export type NewCibaRequest = typeof cibaRequests.$inferInsert;
