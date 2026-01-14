import "server-only";

import type { LibSQLDatabase } from "drizzle-orm/libsql";

import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

// biome-ignore lint/performance/noNamespaceImport: Drizzle ORM requires namespace imports for schema spreading
import * as attestationSchema from "./schema/attestation";
// biome-ignore lint/performance/noNamespaceImport: Drizzle ORM requires namespace imports for schema spreading
import * as authSchema from "./schema/auth";
// biome-ignore lint/performance/noNamespaceImport: Drizzle ORM requires namespace imports for schema spreading
import * as cryptoSchema from "./schema/crypto";
// biome-ignore lint/performance/noNamespaceImport: Drizzle ORM requires namespace imports for schema spreading
import * as identitySchema from "./schema/identity";
// biome-ignore lint/performance/noNamespaceImport: Drizzle ORM requires namespace imports for schema spreading
import * as jwksSchema from "./schema/jwks";
// biome-ignore lint/performance/noNamespaceImport: Drizzle ORM requires namespace imports for schema spreading
import * as oauthProviderSchema from "./schema/oauth-provider";
// biome-ignore lint/performance/noNamespaceImport: Drizzle ORM requires namespace imports for schema spreading
import * as oidc4idaSchema from "./schema/oidc4ida";
// biome-ignore lint/performance/noNamespaceImport: Drizzle ORM requires namespace imports for schema spreading
import * as oidc4vciSchema from "./schema/oidc4vci";
// biome-ignore lint/performance/noNamespaceImport: Drizzle ORM requires namespace imports for schema spreading
import * as onboardingSchema from "./schema/onboarding";
// biome-ignore lint/performance/noNamespaceImport: Drizzle ORM requires namespace imports for schema spreading
import * as recoverySchema from "./schema/recovery";

const schema = {
  ...attestationSchema,
  ...authSchema,
  ...cryptoSchema,
  ...identitySchema,
  ...jwksSchema,
  ...oidc4idaSchema,
  ...oidc4vciSchema,
  ...onboardingSchema,
  ...oauthProviderSchema,
  ...recoverySchema,
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
export function getDatabaseUrl(): string {
  if (isBuildTime()) {
    return "file::memory:";
  }
  return process.env.TURSO_DATABASE_URL || "file:./.data/dev.db";
}

/** Raw libsql client - exported for test cleanup (close connections) */
export const dbClient = createClient({
  url: getDatabaseUrl(),
  authToken: process.env.TURSO_AUTH_TOKEN,
});

export const db: LibSQLDatabase<typeof schema> = drizzle(dbClient, {
  schema,
  logger: process.env.DRIZZLE_LOG === "true",
});
