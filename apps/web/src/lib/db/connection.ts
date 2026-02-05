import "server-only";

import type { LibSQLDatabase } from "drizzle-orm/libsql";

import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

// biome-ignore lint/performance/noNamespaceImport: Drizzle ORM requires namespace imports for schema spreading
import * as attestationSchema from "./schema/attestation";
// biome-ignore lint/performance/noNamespaceImport: Drizzle ORM requires namespace imports for schema spreading
import * as authSchema from "./schema/auth";
// biome-ignore lint/performance/noNamespaceImport: Drizzle ORM requires namespace imports for schema spreading
import * as complianceSchema from "./schema/compliance";
// biome-ignore lint/performance/noNamespaceImport: Drizzle ORM requires namespace imports for schema spreading
import * as cryptoSchema from "./schema/crypto";
// biome-ignore lint/performance/noNamespaceImport: Drizzle ORM requires namespace imports for schema spreading
import * as identitySchema from "./schema/identity";
// biome-ignore lint/performance/noNamespaceImport: Drizzle ORM requires namespace imports for schema spreading
import * as jwksSchema from "./schema/jwks";
// biome-ignore lint/performance/noNamespaceImport: Drizzle ORM requires namespace imports for schema spreading
import * as oauthIdentitySchema from "./schema/oauth-identity";
// biome-ignore lint/performance/noNamespaceImport: Drizzle ORM requires namespace imports for schema spreading
import * as oauthProviderSchema from "./schema/oauth-provider";
// biome-ignore lint/performance/noNamespaceImport: Drizzle ORM requires namespace imports for schema spreading
import * as oidc4idaSchema from "./schema/oidc4ida";
// biome-ignore lint/performance/noNamespaceImport: Drizzle ORM requires namespace imports for schema spreading
import * as oidc4vciSchema from "./schema/oidc4vci";
// biome-ignore lint/performance/noNamespaceImport: Drizzle ORM requires namespace imports for schema spreading
import * as recoverySchema from "./schema/recovery";
// biome-ignore lint/performance/noNamespaceImport: Drizzle ORM requires namespace imports for schema spreading
import * as signUpSchema from "./schema/sign-up";

const schema = {
  ...attestationSchema,
  ...authSchema,
  ...complianceSchema,
  ...cryptoSchema,
  ...identitySchema,
  ...jwksSchema,
  ...oauthIdentitySchema,
  ...oauthProviderSchema,
  ...oidc4idaSchema,
  ...oidc4vciSchema,
  ...recoverySchema,
  ...signUpSchema,
};

function isBuildTime() {
  if (process.env.npm_lifecycle_event === "build") {
    return true;
  }
  const argv = process.argv.join(" ");
  return argv.includes("next") && argv.includes("build");
}

/**
 * Returns the libsql URL for the current process.
 *
 * Build-time uses an in-memory database to avoid SQLite locks across Next.js build workers.
 */
function getDatabaseUrl(): string {
  if (isBuildTime()) {
    return "file::memory:";
  }
  return process.env.TURSO_DATABASE_URL || "file:./.data/dev.db";
}

const dbClient = createClient({
  url: getDatabaseUrl(),
  authToken: process.env.TURSO_AUTH_TOKEN,
});

// Configure SQLite for better concurrent access (defense in depth)
// - busy_timeout: wait up to 5s for locks instead of failing immediately
// - WAL mode: allows concurrent readers during writes
// Errors ignored: PRAGMAs may fail on Turso (not local SQLite) but that's fine
if (!isBuildTime()) {
  dbClient.execute("PRAGMA busy_timeout = 5000;").catch(() => undefined);
  dbClient.execute("PRAGMA journal_mode = WAL;").catch(() => undefined);
}

export const db: LibSQLDatabase<typeof schema> = drizzle(dbClient, {
  schema,
  logger: process.env.DRIZZLE_LOG === "true",
});
