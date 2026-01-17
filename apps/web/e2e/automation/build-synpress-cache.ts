import type { ChildProcess } from "node:child_process";

import { spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

// Top-level regex patterns for lint/performance/useTopLevelRegex compliance
const NEWLINE_PATTERN = /\r?\n/;

const webRoot = process.cwd();
const repoRoot = path.resolve(webRoot, "..", "..");
const contractsPath =
  process.env.E2E_CONTRACTS_PATH ||
  path.resolve(repoRoot, "..", "zama", "zentity-fhevm-contracts");

const hardhatPort = Number(process.env.E2E_HARDHAT_PORT || 8545);
const hardhatUrl = `http://127.0.0.1:${hardhatPort}`;

let hardhatProcess: ChildProcess | null = null;

async function waitForRpc(url: string): Promise<boolean> {
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId" }),
      });
      if (res.ok) {
        return true;
      }
    } catch {
      // ignore
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Hardhat RPC not responding at ${url}`);
}

async function ensureHardhatNode(): Promise<boolean> {
  try {
    const response = await fetch(hardhatUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId" }),
    });
    if (response.ok) {
      return false;
    }
  } catch {
    // not running
  }

  hardhatProcess = spawn(
    "npx",
    ["hardhat", "node", "--hostname", "127.0.0.1", "--port", `${hardhatPort}`],
    {
      cwd: contractsPath,
      stdio: "inherit",
    }
  );

  await waitForRpc(hardhatUrl);
  return true;
}

function stopHardhat() {
  if (hardhatProcess && !hardhatProcess.killed) {
    hardhatProcess.kill("SIGTERM");
  }
}

interface ContractsEnv {
  identityRegistry?: string;
  complianceRules?: string;
  compliantErc20?: string;
}

function deployContracts(): ContractsEnv {
  // Contracts repo uses bun as package manager
  const deploy = spawnSync("bun", ["run", "deploy:local", "--", "--reset"], {
    cwd: contractsPath,
    stdio: "inherit",
    env: process.env,
  });
  if (deploy.status !== 0) {
    process.exit(deploy.status ?? 1);
  }

  const printed = spawnSync(
    "bun",
    ["run", "print:deployments", "localhost", "--env"],
    {
      cwd: contractsPath,
      encoding: "utf8",
      env: process.env,
    }
  );
  if (printed.status !== 0) {
    console.error(printed.stderr || printed.stdout);
    process.exit(printed.status ?? 1);
  }

  const env: Record<string, string> = {};
  for (const line of printed.stdout.trim().split(NEWLINE_PATTERN)) {
    const [key, value] = line.split("=");
    if (key && value) {
      env[key.trim()] = value.trim();
    }
  }

  return {
    identityRegistry: env.IDENTITY_REGISTRY_LOCALHOST,
    complianceRules: env.COMPLIANCE_RULES_LOCALHOST,
    compliantErc20: env.COMPLIANT_ERC20_LOCALHOST,
  };
}

function buildSynpressCache() {
  const cacheDir = path.join(webRoot, ".cache-synpress");
  const walletSetupDir = path.join(webRoot, "e2e", "wallet-setup");

  // Check if cache already exists (any hash directory means cache is present)
  if (existsSync(cacheDir)) {
    const entries = readdirSync(cacheDir);
    const hasCache = entries.some(
      (entry: string) =>
        !(
          entry.startsWith("metamask-chrome-") ||
          entry.endsWith(".zip") ||
          entry.startsWith(".")
        )
    );
    if (hasCache) {
      console.log("[synpress-cache] cache already exists, skipping build");
      return;
    }
  }

  console.log("[synpress-cache] building cache using synpress CLI");

  // Use synpress CLI directly - this is the official way
  const result = spawnSync("pnpm", ["exec", "synpress", walletSetupDir], {
    cwd: webRoot,
    stdio: "inherit",
    env: {
      ...process.env,
      // Run headless in CI, headed locally for debugging
      HEADLESS: process.env.CI === "true" ? "true" : "false",
    },
  });

  if (result.status !== 0) {
    throw new Error(
      `synpress cache build failed with exit code ${result.status}`
    );
  }
  console.log("[synpress-cache] cache built successfully");
}

async function main() {
  console.log("[synpress-cache] start");
  const started = await ensureHardhatNode();
  deployContracts();
  buildSynpressCache();

  if (started) {
    stopHardhat();
  }
  process.exit(0);
}

try {
  await main();
} catch (error) {
  console.error(error);
  stopHardhat();
  process.exit(1);
}
