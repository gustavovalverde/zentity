import "server-only";

import type { LibSQLDatabase } from "drizzle-orm/libsql";

import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

import { env } from "@/env";

// biome-ignore lint/performance/noNamespaceImport: Drizzle ORM requires namespace imports for schema spreading
import * as agentSchema from "./schema/agent";
// biome-ignore lint/performance/noNamespaceImport: Drizzle ORM requires namespace imports for schema spreading
import * as authSchema from "./schema/auth";
// biome-ignore lint/performance/noNamespaceImport: Drizzle ORM requires namespace imports for schema spreading
import * as cibaSchema from "./schema/ciba";
// biome-ignore lint/performance/noNamespaceImport: Drizzle ORM requires namespace imports for schema spreading
import * as identitySchema from "./schema/identity";
// biome-ignore lint/performance/noNamespaceImport: Drizzle ORM requires namespace imports for schema spreading
import * as oauthProviderSchema from "./schema/oauth-provider";
// biome-ignore lint/performance/noNamespaceImport: Drizzle ORM requires namespace imports for schema spreading
import * as oidcCredentialsSchema from "./schema/oidc-credentials";
// biome-ignore lint/performance/noNamespaceImport: Drizzle ORM requires namespace imports for schema spreading
import * as organizationSchema from "./schema/organization";
// biome-ignore lint/performance/noNamespaceImport: Drizzle ORM requires namespace imports for schema spreading
import * as privacySchema from "./schema/privacy";
// biome-ignore lint/performance/noNamespaceImport: Drizzle ORM requires namespace imports for schema spreading
import * as revokedTokensSchema from "./schema/revoked-tokens";

const schema = {
  ...agentSchema,
  ...authSchema,
  ...cibaSchema,
  ...identitySchema,
  ...oauthProviderSchema,
  ...oidcCredentialsSchema,
  ...organizationSchema,
  ...privacySchema,
  ...revokedTokensSchema,
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
  return env.TURSO_DATABASE_URL;
}

const dbClient = createClient({
  url: getDatabaseUrl(),
  ...(env.TURSO_AUTH_TOKEN === undefined
    ? {}
    : { authToken: env.TURSO_AUTH_TOKEN }),
  // Local SQLite: wait up to 5s for a lock instead of failing with
  // SQLITE_BUSY. The client pools connections, so a busy_timeout PRAGMA would
  // reach only one of them; this option applies to each. Turso ignores it.
  timeout: 5000,
});

// WAL lets readers proceed during a write. The mode persists in the database
// file, so one connection setting it is enough. Turso rejects the PRAGMA.
if (!isBuildTime()) {
  dbClient.execute("PRAGMA journal_mode = WAL;").catch(() => undefined);
}

export const db: LibSQLDatabase<typeof schema> = drizzle(dbClient, {
  schema,
  logger: env.DRIZZLE_LOG ?? false,
});
