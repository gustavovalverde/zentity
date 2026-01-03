import "server-only";

import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { drizzle } from "drizzle-orm/bun-sqlite";

// biome-ignore lint/performance/noNamespaceImport: Drizzle ORM requires namespace imports for schema spreading
import * as attestationSchema from "./schema/attestation";
// biome-ignore lint/performance/noNamespaceImport: Drizzle ORM requires namespace imports for schema spreading
import * as authSchema from "./schema/auth";
// biome-ignore lint/performance/noNamespaceImport: Drizzle ORM requires namespace imports for schema spreading
import * as cryptoSchema from "./schema/crypto";
// biome-ignore lint/performance/noNamespaceImport: Drizzle ORM requires namespace imports for schema spreading
import * as identitySchema from "./schema/identity";
// biome-ignore lint/performance/noNamespaceImport: Drizzle ORM requires namespace imports for schema spreading
import * as onboardingSchema from "./schema/onboarding";
// biome-ignore lint/performance/noNamespaceImport: Drizzle ORM requires namespace imports for schema spreading
import * as rpSchema from "./schema/rp";

const schema = {
  ...attestationSchema,
  ...authSchema,
  ...cryptoSchema,
  ...identitySchema,
  ...onboardingSchema,
  ...rpSchema,
};

function isBuildTime() {
  if (process.env.npm_lifecycle_event === "build") {
    return true;
  }
  const argv = process.argv.join(" ");
  return argv.includes("next") && argv.includes("build");
}

/**
 * Returns the default DB path for the current process.
 *
 * Build-time uses :memory: to avoid SQLite locks across Next.js build workers.
 */
export function getDefaultDatabasePath(): string {
  if (isBuildTime()) {
    return ":memory:";
  }
  return process.env.DATABASE_PATH || "./.data/dev.db";
}

function ensureDatabaseDirExists(dbPath: string) {
  if (dbPath === ":memory:") {
    return;
  }
  const dbDir = dirname(dbPath);
  if (dbDir !== "." && !existsSync(dbDir)) {
    mkdirSync(dbDir, { recursive: true });
  }
}

function applyPragmas(conn: Database) {
  try {
    conn.run("PRAGMA journal_mode = WAL");
  } catch {
    // Best-effort: ignore SQLITE_BUSY / readonly FS during builds.
  }
  try {
    conn.run("PRAGMA synchronous = NORMAL");
  } catch {
    // Best-effort
  }
  try {
    conn.run("PRAGMA foreign_keys = ON");
  } catch {
    // Best-effort
  }
  try {
    conn.run("PRAGMA busy_timeout = 5000");
  } catch {
    // Best-effort
  }
}

const globalKey = Symbol.for("zentity.sqlite.connections");
type Store = Map<string, Database>;

function getStore(): Store {
  const g = globalThis as unknown as Record<string | symbol, unknown>;
  if (!g[globalKey]) {
    g[globalKey] = new Map();
  }
  return g[globalKey] as Store;
}

/**
 * Returns a singleton `bun:sqlite` connection for a given dbPath.
 */
export function getSqliteDb(dbPath = getDefaultDatabasePath()): Database {
  const store = getStore();
  const existing = store.get(dbPath);
  if (existing) {
    return existing;
  }

  ensureDatabaseDirExists(dbPath);
  const db = new Database(dbPath);
  applyPragmas(db);
  store.set(dbPath, db);
  return db;
}

const sqlite = getSqliteDb(getDefaultDatabasePath());

export const db = drizzle(sqlite, {
  schema,
  logger: process.env.DRIZZLE_LOG === "true",
});

export { sqlite };
