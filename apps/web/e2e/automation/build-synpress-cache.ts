import type { ChildProcess } from "node:child_process";

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  createCache,
  ensureCacheDirExists,
  prepareExtension,
} from "@synthetixio/synpress-cache";
import fs from "fs-extra";
import { glob } from "glob";
import ts from "typescript";

// Top-level regex patterns for lint/performance/useTopLevelRegex compliance
const TS_JS_MJS_EXTENSION_PATTERN = /\.(ts|js|mjs)$/;
const WALLET_SETUP_CALL_PATTERN = /defineWalletSetup\s*\(/;

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

function extractWalletSetupFunction(sourceCode: string): string {
  const callMatch = WALLET_SETUP_CALL_PATTERN.exec(sourceCode);
  if (callMatch?.index === undefined) {
    throw new Error("Could not find defineWalletSetup call");
  }
  const openParen = callMatch.index + callMatch[0].lastIndexOf("(");

  let depth = 1;
  let commaIndex = -1;
  let closeParen = -1;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let escapeChar = false;

  for (let i = openParen + 1; i < sourceCode.length; i += 1) {
    const ch = sourceCode[i];

    if (escapeChar) {
      escapeChar = false;
      continue;
    }

    if (inSingle) {
      if (ch === "\\") {
        escapeChar = true;
      } else if (ch === "'") {
        inSingle = false;
      }
      continue;
    }
    if (inDouble) {
      if (ch === "\\") {
        escapeChar = true;
      } else if (ch === '"') {
        inDouble = false;
      }
      continue;
    }
    if (inTemplate) {
      if (ch === "\\") {
        escapeChar = true;
      } else if (ch === "`") {
        inTemplate = false;
      }
      continue;
    }

    if (ch === "'") {
      inSingle = true;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      continue;
    }
    if (ch === "`") {
      inTemplate = true;
      continue;
    }

    if (ch === "(") {
      depth += 1;
      continue;
    }
    if (ch === ")") {
      depth -= 1;
      if (depth === 0) {
        closeParen = i;
        break;
      }
      continue;
    }

    if (ch === "," && depth === 1 && commaIndex === -1) {
      commaIndex = i;
    }
  }

  if (commaIndex === -1 || closeParen === -1) {
    throw new Error("Could not extract defineWalletSetup callback");
  }

  return sourceCode.slice(commaIndex + 1, closeParen).trim();
}

function buildWalletSetupFunction(walletSetupFunctionString: string): string {
  const source = `(${walletSetupFunctionString})`;
  const result = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      removeComments: true,
    },
  });
  return result.outputText.trim();
}

function getWalletSetupFuncHash(walletSetupString: string): string {
  const hash = createHash("shake256", { outputLength: 10 });
  return hash.update(walletSetupString).digest("hex");
}

async function compileWalletSetupFunctions(): Promise<{
  outDir: string;
  fileList: string[];
}> {
  const _cacheDir = ensureCacheDirExists();
  const outDir = path.join(webRoot, ".synpress-wallet-setup-dist");
  await fs.ensureDir(outDir);

  const walletSetupDir = path.join(webRoot, "e2e", "wallet-setup");
  console.log(
    "[synpress-cache] compiling wallet setup files from",
    walletSetupDir
  );
  const fileList = (
    await glob(path.join(walletSetupDir, "**", "*.setup.{ts,js,mjs}"))
  ).toSorted((a, b) => a.localeCompare(b));
  if (!fileList.length) {
    throw new Error(
      `No wallet setup files found at ${walletSetupDir}. Ensure files end with .setup.ts/.js/.mjs`
    );
  }

  for (const filePath of fileList) {
    const source = await fs.readFile(filePath, "utf8");
    const result = ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        sourceMap: false,
        inlineSourceMap: false,
      },
      fileName: filePath,
    });
    const base = path
      .basename(filePath)
      .replace(TS_JS_MJS_EXTENSION_PATTERN, ".mjs");
    const outPath = path.join(outDir, base);
    await fs.writeFile(outPath, result.outputText, "utf8");
  }

  console.log("[synpress-cache] compiled wallet setup files", fileList);
  return { outDir, fileList };
}

interface WalletSetupModule {
  default?: {
    hash?: string;
  };
}

async function buildSynpressCache() {
  console.log("[synpress-cache] building cache");
  const { outDir, fileList } = await compileWalletSetupFunctions();
  const hashes: string[] = [];
  const hashMappings: Array<{ compiledHash: string; sourceHash: string }> = [];
  for (const filePath of fileList) {
    const base = path
      .basename(filePath)
      .replace(TS_JS_MJS_EXTENSION_PATTERN, ".mjs");
    const compiledPath = path.join(outDir, base);
    console.log("[synpress-cache] loading compiled setup", compiledPath);
    const mod = (await import(pathToFileURL(compiledPath).href)) as
      | WalletSetupModule
      | undefined;
    console.log("[synpress-cache] loaded compiled setup", compiledPath);
    const hash = mod?.default?.hash;
    if (!hash || typeof hash !== "string") {
      throw new Error(
        `Missing hash for compiled wallet setup: ${compiledPath}`
      );
    }
    hashes.push(hash);

    const sourceCode = await fs.readFile(filePath, "utf8");
    const callbackSource = extractWalletSetupFunction(sourceCode);
    const built = buildWalletSetupFunction(callbackSource);
    const sourceHash = getWalletSetupFuncHash(built);
    hashMappings.push({ compiledHash: hash, sourceHash });
  }

  console.log("[synpress-cache] create cache for hashes", hashes, hashMappings);
  console.log("[synpress-cache] createCache start");
  await createCache(outDir, hashes, prepareExtension, true);
  console.log("[synpress-cache] createCache done");

  for (const { compiledHash, sourceHash } of hashMappings) {
    if (!sourceHash || sourceHash === compiledHash) {
      continue;
    }
    const cacheDir = ensureCacheDirExists();
    const compiledPath = path.join(cacheDir, compiledHash);
    const sourcePath = path.join(cacheDir, sourceHash);
    const sourceExists = await fs.pathExists(sourcePath);
    if (!sourceExists) {
      await fs.copy(compiledPath, sourcePath);
    }
  }
}

async function main() {
  console.log("[synpress-cache] start");
  const started = await ensureHardhatNode();
  process.env.SYNPRESS_NETWORK_RPC_URL = hardhatUrl;
  process.env.SYNPRESS_NETWORK_CHAIN_ID = "31337";
  await buildSynpressCache();

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
