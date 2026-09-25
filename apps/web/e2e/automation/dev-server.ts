import type { ChildProcess } from "node:child_process";

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";

const webRoot = process.cwd();

/**
 * Database URL the dev server should use, in priority order. Kept in the same
 * order as the reset resolution so the server and the reset act on one database.
 */
export function resolveServerDbUrl(): string | undefined {
  return process.env.E2E_TURSO_DATABASE_URL ?? process.env.TURSO_DATABASE_URL;
}

function toFilePath(dbUrlOrPath: string | undefined): string | null {
  if (!dbUrlOrPath) {
    return null;
  }
  if (dbUrlOrPath.startsWith("libsql:")) {
    return null;
  }
  if (dbUrlOrPath.startsWith("file:")) {
    const raw = dbUrlOrPath.slice("file:".length);
    if (raw === ":memory:" || raw === "::memory:") {
      return null;
    }
    return raw;
  }
  return dbUrlOrPath;
}

function resolveResetFile(fallback?: string): string | null {
  return (
    toFilePath(process.env.E2E_TURSO_DATABASE_URL) ??
    toFilePath(process.env.TURSO_DATABASE_URL) ??
    toFilePath(process.env.E2E_DATABASE_PATH) ??
    fallback ??
    null
  );
}

function resetSqliteFile(dbFile: string) {
  mkdirSync(path.dirname(dbFile), { recursive: true });
  const extraFiles = [`${dbFile}-wal`, `${dbFile}-shm`, `${dbFile}-journal`];
  if (existsSync(dbFile)) {
    rmSync(dbFile, { force: true });
  }
  for (const extra of extraFiles) {
    if (existsSync(extra)) {
      rmSync(extra, { force: true });
    }
  }
}

interface BootstrapOptions {
  beforeSpawn?: () => void;
  dbResetFallback?: string;
  env: NodeJS.ProcessEnv;
  onShutdown?: () => void;
  resetDb: boolean;
}

/**
 * Reset the E2E database, push the schema, and start the Next dev server,
 * wiring shutdown to the parent process signals.
 */
export function bootstrapDevServer(options: BootstrapOptions) {
  options.beforeSpawn?.();

  if (options.resetDb) {
    const dbFile = resolveResetFile(options.dbResetFallback);
    if (dbFile) {
      resetSqliteFile(dbFile);
    }
    const push = spawnSync("npx", ["drizzle-kit", "push", "--force"], {
      cwd: webRoot,
      stdio: "inherit",
      env: options.env,
    });
    if (push.status !== 0) {
      process.exit(push.status ?? 1);
    }
  }

  const dev: ChildProcess = spawn("pnpm", ["run", "dev"], {
    cwd: webRoot,
    stdio: "inherit",
    env: options.env,
  });

  const shutdown = () => {
    if (dev && !dev.killed) {
      dev.kill("SIGTERM");
    }
    options.onShutdown?.();
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
  process.on("exit", shutdown);

  dev.on("exit", (code) => {
    shutdown();
    process.exit(code ?? 0);
  });
}
