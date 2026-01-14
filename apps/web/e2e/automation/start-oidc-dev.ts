import type { ChildProcess } from "node:child_process";

import { spawn, spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";

const webRoot = process.cwd();
const shouldResetDb =
  process.env.E2E_RESET_DB === "true" || process.env.E2E_OIDC_ONLY === "true";
const fallbackDbPath = path.join(webRoot, "e2e", ".data", "e2e.db");

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

function startDevServer() {
  if (shouldResetDb) {
    const dbFile =
      toFilePath(process.env.E2E_TURSO_DATABASE_URL) ??
      toFilePath(process.env.TURSO_DATABASE_URL) ??
      toFilePath(process.env.E2E_DATABASE_PATH) ??
      fallbackDbPath;
    if (dbFile) {
      resetSqliteFile(dbFile);
    }
  }

  // Clean up stale Next.js dev lock file to prevent startup issues
  const lockFile = path.join(webRoot, ".next", "dev", "lock");
  if (existsSync(lockFile)) {
    rmSync(lockFile, { force: true });
  }

  const env = {
    ...process.env,
    NEXT_PUBLIC_ENABLE_HARDHAT: "false",
    NEXT_PUBLIC_ENABLE_FHEVM: "false",
    NEXT_PUBLIC_ATTESTATION_DEMO: "false",
    NEXT_PUBLIC_APPKIT_ENABLE_WALLETCONNECT: "false",
    NEXT_PUBLIC_APPKIT_ENABLE_INJECTED: "false",
    NEXT_PUBLIC_APPKIT_ENABLE_EIP6963: "false",
    NEXT_PUBLIC_APPKIT_ANALYTICS: "false",
    NEXT_PUBLIC_COOP: "same-origin-allow-popups",
    TURBOPACK: "",
    NEXT_DISABLE_TURBOPACK: "1",
  };

  if (shouldResetDb) {
    const result = spawnSync("pnpm", ["run", "db:push"], {
      cwd: webRoot,
      stdio: "inherit",
      env,
    });
    if (result.status !== 0) {
      process.exit(result.status ?? 1);
    }
  }

  const dev: ChildProcess = spawn("pnpm", ["run", "dev"], {
    cwd: webRoot,
    stdio: "inherit",
    env,
  });

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
