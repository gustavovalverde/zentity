import { spawn, spawnSync } from "node:child_process";
import path from "node:path";

const webRoot = process.cwd();
const repoRoot = path.resolve(webRoot, "..", "..");
const contractsPath =
  process.env.E2E_CONTRACTS_PATH ||
  path.resolve(repoRoot, "..", "zama", "zentity-fhevm-contracts");

const hardhatPort = Number(process.env.E2E_HARDHAT_PORT || 8545);
const hardhatUrl = `http://127.0.0.1:${hardhatPort}`;
let hardhatProcess = null;

async function waitForRpc(url) {
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId" }),
      });
      if (res.ok) return true;
    } catch {
      // ignore
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Hardhat RPC not responding at ${url}`);
}

async function ensureHardhatNode() {
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
    "bunx",
    ["hardhat", "node", "--hostname", "127.0.0.1", "--port", `${hardhatPort}`],
    {
      cwd: contractsPath,
      stdio: "inherit",
    },
  );

  await waitForRpc(hardhatUrl);
  return true;
}

function deployContracts() {
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
    },
  );
  if (printed.status !== 0) {
    // biome-ignore lint/suspicious/noConsole: helpful failure output for CI
    console.error(printed.stderr || printed.stdout);
    process.exit(printed.status ?? 1);
  }

  const env = {};
  for (const line of printed.stdout.trim().split(/\r?\n/)) {
    const [key, value] = line.split("=");
    if (key && value) env[key.trim()] = value.trim();
  }

  return {
    identityRegistry: env.IDENTITY_REGISTRY_LOCALHOST,
    complianceRules: env.COMPLIANCE_RULES_LOCALHOST,
    compliantErc20: env.COMPLIANT_ERC20_LOCALHOST,
  };
}

function startDevServer(contracts) {
  const env = {
    ...process.env,
    NEXT_PUBLIC_ENABLE_HARDHAT: "true",
    NEXT_PUBLIC_ENABLE_FHEVM: "false",
    NEXT_PUBLIC_ATTESTATION_DEMO: "false",
    NEXT_PUBLIC_COOP: "same-origin-allow-popups",
    LOCAL_RPC_URL: hardhatUrl,
    LOCAL_IDENTITY_REGISTRY: contracts.identityRegistry || "",
    LOCAL_COMPLIANCE_RULES: contracts.complianceRules || "",
    LOCAL_COMPLIANT_ERC20: contracts.compliantErc20 || "",
    REGISTRAR_PRIVATE_KEY:
      process.env.REGISTRAR_PRIVATE_KEY ||
      "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
    FHEVM_PROVIDER_ID: "mock",
    NEXT_PUBLIC_FHEVM_PROVIDER_ID: "mock",
  };

  const dev = spawn("bun", ["run", "dev"], {
    cwd: webRoot,
    stdio: "inherit",
    env,
  });

  const shutdown = () => {
    if (dev && !dev.killed) dev.kill("SIGTERM");
    if (hardhatProcess && !hardhatProcess.killed) {
      hardhatProcess.kill("SIGTERM");
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

async function main() {
  await ensureHardhatNode();
  const contracts = deployContracts();
  startDevServer(contracts);
}

main().catch((error) => {
  // biome-ignore lint/suspicious/noConsole: surface startup failures in CI
  console.error(error);
  process.exit(1);
});
