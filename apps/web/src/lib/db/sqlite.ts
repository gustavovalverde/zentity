import { Database } from "bun:sqlite";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * SQLite connection utilities (Better Auth + app DB).
 *
 * Why this exists:
 * - `next build` evaluates server modules in multiple worker processes/threads.
 * - If our modules open the same SQLite file and run PRAGMAs / CREATE TABLE at
 *   import-time, the build can fail with `SQLITE_BUSY: database is locked`.
 *
 * Design:
 * - During build-time we use `:memory:` to make builds deterministic and avoid
 *   filesystem locks.
 * - At runtime we use `DATABASE_PATH` (or `./dev.db`) and enable WAL.
 * - Within a single process we reuse one DB handle per dbPath via a global map.
 */

function isBuildTime() {
  if (process.env.npm_lifecycle_event === "build") return true;
  const argv = process.argv.join(" ");
  return argv.includes("next") && argv.includes("build");
}

/**
 * Returns the default DB path for the current process.
 *
 * Note: Build-time uses `:memory:` to avoid `SQLITE_BUSY` across Next.js build workers.
 */
export function getDefaultDatabasePath() {
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
    db.run("PRAGMA journal_mode = WAL");
  } catch {
    // Best-effort: ignore SQLITE_BUSY / readonly FS during builds.
  }
  try {
    db.run("PRAGMA synchronous = NORMAL");
  } catch {
    // Best-effort
  }
}

const globalKey = Symbol.for("zentity.sqlite.connections");

type Store = Map<string, Database>;

function getStore(): Store {
  const g = globalThis as unknown as Record<string | symbol, unknown>;
  if (!g[globalKey]) g[globalKey] = new Map();
  return g[globalKey] as Store;
}

/**
 * Returns a singleton `bun:sqlite` connection for a given dbPath.
 *
 * Prefer this over `new Database(...)` in modules to reduce lock contention and
 * ensure consistent PRAGMA configuration.
 */
export function getSqliteDb(dbPath = getDefaultDatabasePath()) {
  const store = getStore();
  const existing = store.get(dbPath);
  if (existing) return existing;

  ensureDatabaseDirExists(dbPath);
  const db = new Database(dbPath);
  applyPragmas(db);
  store.set(dbPath, db);
  return db;
}

/**
 * True when the process is running as part of `next build` (heuristic).
 */
export function isSqliteBuildTime() {
  return isBuildTime();
}
