import { spawn } from "node:child_process";
import path from "node:path";

const root = path.resolve(__dirname, "..", "..", "..");
const webDir = path.join(root, "apps", "web");
const hubDir = path.join(root, "apps", "demo-hub");
const walletDir = path.join(root, "apps", "demo-wallet");

const demoHubUrl = process.env.NEXT_PUBLIC_DEMO_HUB_URL ?? "http://localhost:3100";
const demoWalletUrl =
  process.env.NEXT_PUBLIC_WALLET_URL ?? "http://localhost:3101";
const zentityBaseUrl = process.env.ZENTITY_BASE_URL ?? "http://localhost:3000";

const demoDbPath = path.join(webDir, "e2e", ".data", "demo.db");
const demoDbUrl = `file:${demoDbPath}`;

function spawnProcess(
  name: string,
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  cwd: string
) {
  const child = spawn(command, args, {
    cwd,
    env,
    stdio: "inherit",
  });
  child.on("exit", (code) => {
    if (code && code !== 0) {
      process.exit(code);
    }
  });
  return child;
}

const baseEnv = {
  ...process.env,
  DEMO_SEED_SECRET: process.env.DEMO_SEED_SECRET ?? "demo-seed-secret",
  DEMO_SUBJECT_EMAIL:
    process.env.DEMO_SUBJECT_EMAIL ?? "demo-subject@zentity.dev",
  DEMO_SUBJECT_PASSWORD:
    process.env.DEMO_SUBJECT_PASSWORD ?? "demo-subject-password",
  DEMO_ISSUER_EMAIL:
    process.env.DEMO_ISSUER_EMAIL ?? "demo-issuer@zentity.dev",
  DEMO_ISSUER_PASSWORD:
    process.env.DEMO_ISSUER_PASSWORD ?? "demo-issuer-password",
  NEXT_PUBLIC_DEMO_HUB_URL: demoHubUrl,
  NEXT_PUBLIC_WALLET_URL: demoWalletUrl,
  NEXT_PUBLIC_ZENTITY_BASE_URL: zentityBaseUrl,
  NEXT_PUBLIC_DEMO_SUBJECT_EMAIL:
    process.env.DEMO_SUBJECT_EMAIL ?? "demo-subject@zentity.dev",
  ZENTITY_BASE_URL: zentityBaseUrl,
};

const webEnv = {
  ...baseEnv,
  E2E_OIDC_ONLY: "true",
  E2E_DATABASE_PATH: demoDbPath,
  E2E_TURSO_DATABASE_URL: demoDbUrl,
  TURSO_DATABASE_URL: demoDbUrl,
  NEXT_PUBLIC_APP_URL: zentityBaseUrl,
  BETTER_AUTH_URL: `${zentityBaseUrl}/api/auth`,
  // Auth secret - use env var if available, otherwise fall back to demo secret
  BETTER_AUTH_SECRET:
    process.env.BETTER_AUTH_SECRET ??
    "demo-auth-secret-32-chars-minimum-for-local........",
  TRUSTED_ORIGINS: [demoHubUrl, demoWalletUrl].join(","),
  NEXT_PUBLIC_ENABLE_FHEVM: "false",
  NEXT_PUBLIC_ENABLE_HARDHAT: "false",
};

const hubEnv = {
  ...baseEnv,
  PORT: "3100",
};

const walletEnv = {
  ...baseEnv,
  PORT: "3101",
};

async function waitForServer(url: string, timeoutMs = 120_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const res = await fetch(url, { method: "GET" });
      if (res.ok) {
        return;
      }
    } catch {
      // ignore until timeout
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function main() {
  const web = spawnProcess(
    "web",
    "pnpm",
    ["exec", "tsx", "e2e/automation/start-oidc-dev.ts"],
    webEnv,
    webDir
  );

  const healthUrl = `${zentityBaseUrl}/api/health`;
  await waitForServer(healthUrl);

  const hub = spawnProcess("hub", "pnpm", ["run", "dev"], hubEnv, hubDir);
  const wallet = spawnProcess(
    "wallet",
    "pnpm",
    ["run", "dev"],
    walletEnv,
    walletDir
  );

  const shutdown = () => {
    for (const proc of [web, hub, wallet]) {
      if (proc && !proc.killed) {
        proc.kill("SIGTERM");
      }
    }
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  process.on("exit", shutdown);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
