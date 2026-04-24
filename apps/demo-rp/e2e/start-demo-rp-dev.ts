import type { ChildProcess } from "node:child_process";

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";

const demoRpRoot = process.cwd();
const shouldResetDb = process.env.E2E_RESET_DB === "true";
const fallbackDbPath = join(demoRpRoot, ".data", "e2e.db");
const demoRpPort = process.env.PORT ?? "3102";

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

function resetSqliteFile(dbFile: string) {
  mkdirSync(dirname(dbFile), { recursive: true });
  const extraFiles = [`${dbFile}-wal`, `${dbFile}-shm`, `${dbFile}-journal`];
  if (existsSync(dbFile)) {
    rmSync(dbFile, { force: true });
  }
  for (const extraFile of extraFiles) {
    if (existsSync(extraFile)) {
      rmSync(extraFile, { force: true });
    }
  }
}

function runCommand(command: string, args: string[], env: NodeJS.ProcessEnv) {
  const result = spawnSync(command, args, {
    cwd: demoRpRoot,
    stdio: "inherit",
    env,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function resetNextArtifacts() {
  const nextDir = join(demoRpRoot, ".next");
  if (existsSync(nextDir)) {
    rmSync(nextDir, { recursive: true, force: true });
  }
}

function startDevServer() {
  if (shouldResetDb) {
    const dbFile =
      toFilePath(process.env.DATABASE_URL) ??
      toFilePath(process.env.DEMO_RP_DATABASE_URL) ??
      fallbackDbPath;
    if (dbFile) {
      resetSqliteFile(dbFile);
    }
  }

  resetNextArtifacts();

  const env = {
    ...process.env,
    TURBOPACK: "",
    NEXT_DISABLE_TURBOPACK: "1",
  };

  runCommand("pnpm", ["exec", "tsx", "scripts/generate-dev-certs.ts"], env);
  runCommand("pnpm", ["exec", "drizzle-kit", "push", "--force"], env);

  const dev: ChildProcess = spawn(
    "pnpm",
    ["exec", "next", "dev", "--webpack", "--port", demoRpPort],
    {
      cwd: demoRpRoot,
      stdio: "inherit",
      env,
    }
  );

  const shutdown = () => {
    if (dev && !dev.killed) {
      dev.kill("SIGTERM");
    }
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
  process.on("exit", shutdown);

  dev.on("exit", (code) => {
    shutdown();
    process.exit(code ?? 0);
  });
}

startDevServer();
