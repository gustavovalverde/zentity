import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { users } from "./auth";
import { authenticationContexts } from "./authentication-context";
import { oauthClients } from "./oauth-provider";
import { defaultId } from "./utils";

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
