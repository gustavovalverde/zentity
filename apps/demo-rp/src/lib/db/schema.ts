import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  emailVerified: text("emailVerified").notNull().default("0"),
  image: text("image"),
  createdAt: text("createdAt").notNull().default("datetime('now')"),
  updatedAt: text("updatedAt").notNull().default("datetime('now')"),
  claims: text("claims"),
});

export const session = sqliteTable("session", {
  id: text("id").primaryKey(),
  expiresAt: text("expiresAt").notNull(),
  token: text("token").notNull().unique(),
  createdAt: text("createdAt").notNull().default("datetime('now')"),
  updatedAt: text("updatedAt").notNull().default("datetime('now')"),
  ipAddress: text("ipAddress"),
  userAgent: text("userAgent"),
  userId: text("userId")
    .notNull()
    .references(() => user.id),
});

export const account = sqliteTable("account", {
  id: text("id").primaryKey(),
  accountId: text("accountId").notNull(),
  providerId: text("providerId").notNull(),
  userId: text("userId")
    .notNull()
    .references(() => user.id),
  accessToken: text("accessToken"),
  refreshToken: text("refreshToken"),
  idToken: text("idToken"),
  accessTokenExpiresAt: text("accessTokenExpiresAt"),
  refreshTokenExpiresAt: text("refreshTokenExpiresAt"),
  scope: text("scope"),
  password: text("password"),
  createdAt: text("createdAt").notNull().default("datetime('now')"),
  updatedAt: text("updatedAt").notNull().default("datetime('now')"),
});

export const verification = sqliteTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: text("expiresAt").notNull(),
  createdAt: text("createdAt").notNull().default("datetime('now')"),
  updatedAt: text("updatedAt").notNull().default("datetime('now')"),
});

export const dcrClient = sqliteTable("dcr_client", {
  providerId: text("providerId").primaryKey(),
  clientId: text("clientId").notNull(),
  clientSecret: text("clientSecret"),
});

export const cibaPings = sqliteTable("ciba_ping", {
  authReqId: text("auth_req_id").primaryKey(),
  notificationToken: text("notification_token").notNull(),
  received: integer("received", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const vpSessions = sqliteTable("vp_session", {
  id: text("id").primaryKey(),
  nonce: text("nonce").notNull(),
  state: text("state").notNull(),
  dcqlQuery: text("dcqlQuery").notNull(),
  status: text("status", {
    enum: ["pending", "verified", "expired", "failed"],
  })
    .notNull()
    .default("pending"),
  result: text("result"),
  encryptionKey: text("encryptionKey").notNull(),
  sessionCookie: text("sessionCookie"),
  scenarioId: text("scenarioId").notNull(),
  createdAt: integer("createdAt", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  expiresAt: integer("expiresAt", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date(Date.now() + 5 * 60 * 1000)),
});
