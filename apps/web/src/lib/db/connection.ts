import "server-only";

import { Database } from "bun:sqlite";
import * as fs from "node:fs";
import * as path from "node:path";

import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";

import * as schema from "./schema";

function isBuildTime() {
  if (process.env.npm_lifecycle_event === "build") return true;
  const argv = process.argv.join(" ");
  return argv.includes("next") && argv.includes("build");
}

/**
 * Returns the default DB path for the current process.
 *
 * Build-time uses :memory: to avoid SQLite locks across Next.js build workers.
 */
export function getDefaultDatabasePath(): string {
  if (isBuildTime()) return ":memory:";
  return process.env.DATABASE_PATH || "./dev.db";
}

function ensureDatabaseDirExists(dbPath: string) {
  if (dbPath === ":memory:") return;
  const dbDir = path.dirname(dbPath);
  if (dbDir !== "." && !fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }
}

function applyPragmas(db: Database) {
  try {
    db.exec("PRAGMA journal_mode = WAL");
  } catch {
    // Best-effort: ignore SQLITE_BUSY / readonly FS during builds.
  }
  try {
    db.exec("PRAGMA synchronous = NORMAL");
  } catch {
    // Best-effort
  }
  try {
    db.exec("PRAGMA foreign_keys = ON");
  } catch {
    // Best-effort
  }
  try {
    db.exec("PRAGMA busy_timeout = 5000");
  } catch {
    // Best-effort
  }
}

const globalKey = Symbol.for("zentity.sqlite.connections");
const migratedKey = Symbol.for("zentity.sqlite.migrations");

type Store = Map<string, Database>;

type MigrationStore = Set<string>;

function getStore(): Store {
  const g = globalThis as unknown as Record<string | symbol, unknown>;
  if (!g[globalKey]) g[globalKey] = new Map();
  return g[globalKey] as Store;
}

function getMigrationStore(): MigrationStore {
  const g = globalThis as unknown as Record<string | symbol, unknown>;
  if (!g[migratedKey]) g[migratedKey] = new Set();
  return g[migratedKey] as MigrationStore;
}

/**
 * Returns a singleton `bun:sqlite` connection for a given dbPath.
 */
export function getSqliteDb(dbPath = getDefaultDatabasePath()): Database {
  const store = getStore();
  const existing = store.get(dbPath);
  if (existing) return existing;

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

function shouldRunMigrations(dbPath: string): boolean {
  if (isBuildTime()) return false;
  // Default: auto-migrate in dev/test, opt-in in production.
  if (process.env.DATABASE_AUTO_MIGRATE === "false") return false;
  if (
    process.env.NODE_ENV === "production" &&
    process.env.DATABASE_AUTO_MIGRATE !== "true"
  ) {
    return false;
  }
  // Only run once per dbPath to avoid concurrent migration attempts.
  const migrated = getMigrationStore();
  if (migrated.has(dbPath)) return false;
  return true;
}

function runMigrations() {
  const dbPath = getDefaultDatabasePath();
  if (!shouldRunMigrations(dbPath)) return;

  const migrationsFolder = path.join(process.cwd(), "src/lib/db/migrations");

  migrate(db, { migrationsFolder });
  getMigrationStore().add(dbPath);
}

runMigrations();

export { sqlite };
