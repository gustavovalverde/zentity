#!/usr/bin/env bun

/**
 * E2E smoke test for the MCP Agent Server.
 *
 * Spawns the MCP server as a stdio child process and exercises
 * the core flows via the MCP Client SDK.
 *
 * Usage:
 *   bun run scripts/e2e-smoke.ts                    # basic (echo + tool listing)
 *   bun run scripts/e2e-smoke.ts --with-auth         # includes FPA auth (requires running Zentity)
 *   bun run scripts/e2e-smoke.ts --with-ciba         # includes CIBA approval (requires manual action)
 *
 * Prerequisites for --with-auth / --with-ciba:
 *   1. Zentity running at ZENTITY_URL (default: http://localhost:3000)
 *   2. A test user with an OPAQUE password (email + password prompted)
 *
 * Environment:
 *   ZENTITY_URL   — Zentity instance URL (default: http://localhost:3000)
 *   SMOKE_EMAIL   — Skip email prompt (for CI-like usage)
 *   SMOKE_PASSWORD — Skip password prompt (for CI-like usage)
 */

import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// ──────────────────────────────────────────────
// Config
// ──────────────────────────────────────────────

const args = process.argv.slice(2);
const withAuth = args.includes("--with-auth") || args.includes("--with-ciba");
const withCiba = args.includes("--with-ciba");
const serverEntry = resolve(import.meta.dirname, "../src/index.ts");
const zentityUrl = process.env.ZENTITY_URL ?? "http://localhost:3000";

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

let passed = 0;
let failed = 0;

function pass(name: string, detail?: string): void {
  passed++;
  const suffix = detail ? ` — ${detail}` : "";
  console.log(`  ✓ ${name}${suffix}`);
}

function fail(name: string, error: unknown): void {
  failed++;
  const msg = error instanceof Error ? error.message : String(error);
  console.log(`  ✗ ${name} — ${msg}`);
}

async function step<T>(
  name: string,
  fn: () => Promise<T>
): Promise<T | undefined> {
  try {
    const result = await fn();
    pass(name);
    return result;
  } catch (error) {
    fail(name, error);
    return undefined;
  }
}

// ──────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("\n🔌 MCP Agent Server — E2E Smoke Test\n");
  console.log(`  Server entry: ${serverEntry}`);
  console.log(`  Zentity URL:  ${zentityUrl}`);
  console.log(`  Auth:         ${withAuth ? "yes" : "no (use --with-auth)"}`);
  console.log(`  CIBA:         ${withCiba ? "yes" : "no (use --with-ciba)"}`);
  console.log();

  // ── 1. Spawn MCP server via stdio ────────────
  console.log("─── Transport ───");

  const transport = new StdioClientTransport({
    command: "bun",
    args: ["run", serverEntry],
    env: { ...process.env, ZENTITY_URL: zentityUrl },
    stderr: "pipe",
  });

  const stderrChunks: string[] = [];
  if (transport.stderr) {
    transport.stderr.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk.toString());
    });
  }

  const client = new Client({
    name: "e2e-smoke",
    version: "0.1.0",
  });

  await step("Connect to MCP server via stdio", async () => {
    await client.connect(transport);
  });

  if (failed > 0) {
    console.log("\n⚠️  Cannot connect to server. Check stderr:\n");
    console.log(stderrChunks.join(""));
    return summary();
  }

  // ── 2. Tool listing ──────────────────────────
  console.log("\n─── Tools ───");

  const tools = await step("List tools (tools/list)", async () => {
    const { tools } = await client.listTools();
    return tools;
  });

  if (tools) {
    const toolNames = tools.map((t) => t.name).sort();
    pass("Tool count", `${tools.length} tools registered`);

    const expected = [
      "check_compliance",
      "echo",
      "my_proofs",
      "purchase",
      "request_approval",
      "whoami",
    ];
    for (const name of expected) {
      if (toolNames.includes(name)) {
        pass(`Tool registered: ${name}`);
      } else {
        fail(`Tool registered: ${name}`, "not found in tools/list");
      }
    }
  }

  // ── 3. Echo tool ─────────────────────────────
  console.log("\n─── Echo ───");

  await step("Call echo", async () => {
    const result = await client.callTool({
      name: "echo",
      arguments: { message: "smoke test" },
    });
    const text = (result.content as Array<{ text: string }>)[0]?.text;
    if (text !== "smoke test") {
      throw new Error(`Expected "smoke test", got "${text}"`);
    }
  });

  await step("Echo with unicode", async () => {
    const msg = "こんにちは 🌐";
    const result = await client.callTool({
      name: "echo",
      arguments: { message: msg },
    });
    const text = (result.content as Array<{ text: string }>)[0]?.text;
    if (text !== msg) {
      throw new Error(`Expected "${msg}", got "${text}"`);
    }
  });

  // ── 4. Authenticated flows (optional) ────────
  if (withAuth) {
    console.log("\n─── Auth ───");
    console.log(
      "  ℹ️  Auth flows require FPA integration with a running Zentity."
    );
    console.log("  ℹ️  The MCP server handles auth internally on first start.");
    console.log(
      "  ℹ️  These tests verify tool calls that require authentication.\n"
    );

    await step("Call whoami (requires auth)", async () => {
      const result = await client.callTool({
        name: "whoami",
        arguments: {},
      });
      if (result.isError) {
        const text = (result.content as Array<{ text: string }>)[0]?.text;
        throw new Error(`Tool returned error: ${text}`);
      }
      const text = (result.content as Array<{ text: string }>)[0]?.text;
      if (!text) {
        throw new Error("Empty response");
      }
      const data = JSON.parse(text);
      if (typeof data.tier !== "number") {
        throw new Error(`Expected tier in response, got: ${text.slice(0, 100)}`);
      }
      console.log(
        `    email=${data.email}, tier=${data.tier} (${data.tierName})`
      );
    });

    await step("Call my_proofs (requires auth)", async () => {
      const result = await client.callTool({
        name: "my_proofs",
        arguments: {},
      });
      if (result.isError) {
        const text = (result.content as Array<{ text: string }>)[0]?.text;
        throw new Error(`Tool returned error: ${text}`);
      }
      const text = (result.content as Array<{ text: string }>)[0]?.text;
      if (!text) {
        throw new Error("Empty response");
      }
      const data = JSON.parse(text);
      if (typeof data.totalProofs !== "number") {
        throw new Error(`Expected totalProofs, got: ${text.slice(0, 100)}`);
      }
      console.log(
        `    proofs=${data.totalProofs}, isOver18=${data.isOver18}`
      );
    });

    await step("Call check_compliance (requires auth)", async () => {
      const result = await client.callTool({
        name: "check_compliance",
        arguments: {},
      });
      if (result.isError) {
        const text = (result.content as Array<{ text: string }>)[0]?.text;
        throw new Error(`Tool returned error: ${text}`);
      }
      const text = (result.content as Array<{ text: string }>)[0]?.text;
      if (!text) {
        throw new Error("Empty response");
      }
      const data = JSON.parse(text);
      if (!data.networks || !Array.isArray(data.networks)) {
        throw new Error(`Expected networks array, got: ${text.slice(0, 100)}`);
      }
      console.log(`    ${data.networks.length} network(s) found`);
    });
  }

  if (withCiba) {
    console.log("\n─── CIBA ───");
    console.log("  ℹ️  CIBA requires a user to approve the request manually.");
    console.log(
      "  ℹ️  Check the Zentity dashboard or push notification to approve.\n"
    );

    await step(
      "Call request_approval (requires manual approval)",
      async () => {
        const result = await client.callTool({
          name: "request_approval",
          arguments: {
            action: "E2E smoke test approval",
            details: `Automated test at ${new Date().toISOString()}`,
          },
        });
        const text = (result.content as Array<{ text: string }>)[0]?.text;
        if (!text) {
          throw new Error("Empty response");
        }
        console.log(`    Response: ${text.slice(0, 200)}`);
      }
    );
  }

  // ── 5. Cleanup ───────────────────────────────
  await client.close();
  summary();
}

function summary(): void {
  console.log(`\n─── Summary: ${passed} passed, ${failed} failed ───\n`);
  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Fatal:", error);
  process.exit(1);
});
