import type { ChildProcess } from "node:child_process";

import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Build (release) and run zpay-runtime for the Playwright E2E.
 *
 * Configured via env so the same script works in CI, local runs, and
 * an operator override:
 *
 * - `ZPAY_REPO_PATH`: absolute path to the zpay repo. Defaults to
 *   `/Users/gustavovalverde/dev/zfnd/zpay`.
 * - `ZPAY_E2E_APP_PORT`: app listener (the URL demo-rp talks to).
 *   Defaults to 18080.
 * - `ZPAY_E2E_OPS_PORT`: ops listener. Defaults to 18081.
 * - `ZPAY_E2E_PAYEE_ID`: payee the BFF will use. Must match the key
 *   in the generated TOML. Defaults to `aether-demo`.
 *
 * The payee TOML and the libSQL file are written to a freshly minted
 * tempdir per run so two parallel test runs (if ever enabled) never
 * collide.
 */

const zpayRepo =
  process.env.ZPAY_REPO_PATH ?? "/Users/gustavovalverde/dev/zfnd/zpay";
const appPort = process.env.ZPAY_E2E_APP_PORT ?? "18080";
const opsPort = process.env.ZPAY_E2E_OPS_PORT ?? "18081";
const payeeId = process.env.ZPAY_E2E_PAYEE_ID ?? "aether-demo";
// Fixed placeholder unified address. zpay never settles this in the
// bridge-mount-only E2E; the registry just needs a non-empty pay_to.
const placeholderPayTo =
  "utest1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq";

function ensureBinary(): string {
  const buildResult = spawnSync(
    "cargo",
    ["build", "--release", "-p", "zpay-runtime"],
    { cwd: zpayRepo, stdio: "inherit" }
  );
  if (buildResult.status !== 0) {
    process.exit(buildResult.status ?? 1);
  }
  return join(zpayRepo, "target", "release", "zpay-runtime");
}

function writePayeeConfig(workDir: string): string {
  const config = `
[payees."${payeeId}"]
accepts = [
  { scheme = "zcash", network = "testnet", pay_to = "${placeholderPayTo}", amount_zat = 1, max_validity_seconds = 1800 },
]
`.trim();
  const path = join(workDir, "payees.toml");
  writeFileSync(path, `${config}\n`);
  return path;
}

function start() {
  const binary = ensureBinary();
  const workDir = mkdtempSync(join(tmpdir(), "zpay-e2e-"));
  const payeeConfigPath = writePayeeConfig(workDir);
  const libsqlUrl = `file:${join(workDir, "zpay.libsql")}`;

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ZPAY_SERVER__BIND_ADDR: `127.0.0.1:${appPort}`,
    ZPAY_OPS__BIND_ADDR: `127.0.0.1:${opsPort}`,
    ZPAY_NETWORK: "testnet",
    ZPAY_STORE__BACKEND: "libsql",
    ZPAY_STORE__URL: libsqlUrl,
    ZPAY_PAYEES__CONFIG_PATH: payeeConfigPath,
    // Pin DPoP canonicalization to the loopback authority the BFF
    // talks to so the verifier matches the inbound URL byte-for-byte
    // regardless of how axum sees the Host header.
    ZPAY_EXPECTED_HOST: `127.0.0.1:${appPort}`,
    ZPAY_EXPECTED_SCHEME: "http",
  };

  const runtime: ChildProcess = spawn(binary, [], {
    cwd: zpayRepo,
    stdio: "inherit",
    env,
  });

  const shutdown = () => {
    if (runtime && !runtime.killed) {
      runtime.kill("SIGTERM");
    }
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
  process.on("exit", shutdown);

  runtime.on("exit", (code) => {
    shutdown();
    process.exit(code ?? 0);
  });
}

start();
