#!/usr/bin/env bun

/**
 * End-to-end smoke test for the MCP server.
 *
 * The server runs as a child process with a throwaway HOME, so it never reads
 * or writes the operator's ~/.zentity, and it never opens a browser: sign-in
 * and approval URLs are printed for the operator to open.
 *
 * Usage:
 *   bun run scripts/e2e-smoke.ts                  # tool surface only, no Zentity needed
 *   bun run scripts/e2e-smoke.ts --with-auth      # + whoami, my_proofs, check_compliance
 *   bun run scripts/e2e-smoke.ts --with-ciba      # + my_profile and purchase approvals
 *
 * Options:
 *   --transport stdio|http   Transport to exercise (default: stdio)
 *   --era legacy|modern      Protocol era the client negotiates (default: legacy)
 *   --port <port>            HTTP port; Zentity must list http://localhost:<port>
 *                            as its MCP resource (default: 3300)
 *
 * Environment:
 *   ZENTITY_URL              Zentity base URL (default: http://localhost:3000)
 *   SMOKE_LOGIN_HINT         User id of the approving user (HTTP transport); the
 *                            smoke client registers with public subjects, so
 *                            the user id is the subject CIBA accepts
 *   SMOKE_TIMEOUT_MS         How long to wait for each sign-in or approval (default: 300000)
 */

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  type CallToolResult,
  Client,
  type ClientOptions,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { requestCibaApproval } from "@zentity/sdk";
import { buildLoopbackClientRegistration } from "@zentity/sdk/node";
import { createDpopClient } from "@zentity/sdk/rp";

const args = process.argv.slice(2);
const withCiba = args.includes("--with-ciba");
const withAuth = withCiba || args.includes("--with-auth");
const transportName = readOption("--transport", "stdio");
const era = readOption("--era", "legacy");
const httpPort = readOption("--port", "3300");
const zentityUrl = process.env.ZENTITY_URL ?? "http://localhost:3000";
const timeoutMs = Number(process.env.SMOKE_TIMEOUT_MS ?? 300_000);
const serverEntry = resolve(import.meta.dirname, "../src/index.ts");
const POLL_INTERVAL_MS = 5000;
const REMOTE_SCOPES = "openid email compliance:read proof:identity";
const EXPECTED_TOOLS = [
  "check_compliance",
  "my_profile",
  "my_proofs",
  "purchase",
  "whoami",
];

type Structured = Record<string, unknown>;

let passed = 0;
let failed = 0;

function readOption(name: string, fallback: string): string {
  const index = args.indexOf(name);
  return index === -1 ? fallback : (args[index + 1] ?? fallback);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function step(name: string, fn: () => Promise<string | undefined>) {
  try {
    const detail = await fn();
    passed++;
    console.log(`  ✓ ${name}${detail ? ` (${detail})` : ""}`);
  } catch (error) {
    failed++;
    const message = error instanceof Error ? error.message : String(error);
    console.log(`  ✗ ${name}: ${message}`);
  }
}

function sleep(ms: number) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function clientOptions(): ClientOptions {
  return era === "modern"
    ? { versionNegotiation: { mode: { pin: "2026-07-28" } } }
    : {};
}

async function callTool(
  client: Client,
  name: string,
  toolArgs: Record<string, unknown>
): Promise<Structured> {
  const result = (await client.callTool(
    { name, arguments: toolArgs },
    { timeout: timeoutMs }
  )) as CallToolResult;
  const text = result.content
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("");
  assert(!result.isError, `tool error: ${text}`);
  assert(result.structuredContent, "missing structuredContent");
  return result.structuredContent as Structured;
}

/** Calls an approval-gated tool until the user acts on the printed URL. */
async function callUntilApproved(
  client: Client,
  name: string,
  toolArgs: Record<string, unknown>
): Promise<Structured> {
  const deadline = Date.now() + timeoutMs;
  let result = await callTool(client, name, toolArgs);
  const interaction = result.interaction as { url?: string } | undefined;
  assert(
    result.status === "needs_user_action" && interaction?.url,
    `expected needs_user_action with an approval URL, got ${result.status}`
  );
  console.log(`    → Approve in a browser: ${interaction.url}`);

  while (result.status === "needs_user_action" && Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    result = await callTool(client, name, toolArgs);
  }
  return result;
}

function pipeServerLogs(
  stream: {
    on(event: "data", listener: (chunk: Buffer) => void): unknown;
  } | null
) {
  stream?.on("data", (chunk: Buffer) => {
    for (const line of chunk.toString().split("\n")) {
      if (line.trim()) {
        console.error(`    [server] ${line}`);
      }
    }
  });
}

async function connectStdio(home: string): Promise<Client> {
  const transport = new StdioClientTransport({
    command: "bun",
    args: ["run", serverEntry],
    env: {
      HOME: home,
      PATH: process.env.PATH ?? "",
      ZENTITY_MCP_NO_BROWSER: "1",
      ZENTITY_URL: zentityUrl,
    },
    stderr: "pipe",
  });
  pipeServerLogs(transport.stderr);
  const client = new Client(
    { name: "zentity-e2e-smoke", version: "0.1.0" },
    clientOptions()
  );
  await client.connect(transport);
  return client;
}

async function requestRemoteToken(mcpUrl: string) {
  const loginHint = process.env.SMOKE_LOGIN_HINT;
  assert(loginHint, "SMOKE_LOGIN_HINT is required for the HTTP transport");

  const registration = await fetch(`${zentityUrl}/api/auth/oauth2/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...buildLoopbackClientRegistration({
        clientName: "zentity-e2e-smoke",
        grantTypes: ["authorization_code", "urn:openid:params:grant-type:ciba"],
        scope: REMOTE_SCOPES,
      }),
      subject_type: "public",
    }),
  });
  assert(
    registration.ok,
    `client registration failed: ${registration.status} ${await registration.clone().text()}`
  );
  const { client_id: clientId } = (await registration.json()) as {
    client_id: string;
  };

  const dpopClient = await createDpopClient();
  const tokenSet = await requestCibaApproval({
    cibaEndpoint: `${zentityUrl}/api/auth/oauth2/bc-authorize`,
    tokenEndpoint: `${zentityUrl}/api/auth/oauth2/token`,
    clientId,
    dpopSigner: dpopClient,
    loginHint,
    scope: REMOTE_SCOPES,
    bindingMessage: "Zentity smoke test: connect to the MCP server",
    resource: new URL(mcpUrl).origin,
    onPendingApproval: (pending) => {
      console.log(`    → Approve MCP access: ${pending.approvalUrl}`);
    },
  });
  return { accessToken: tokenSet.accessToken, dpopClient };
}

async function connectHttp(home: string): Promise<Client> {
  const publicUrl = `http://localhost:${httpPort}`;
  const child = spawn(
    "bun",
    ["run", serverEntry, "--transport", "http", "--port", httpPort],
    {
      env: {
        HOME: home,
        PATH: process.env.PATH ?? "",
        MCP_PUBLIC_URL: publicUrl,
        ZENTITY_MCP_NO_BROWSER: "1",
        ZENTITY_URL: zentityUrl,
      },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
  pipeServerLogs(child.stderr);
  process.once("exit", () => child.kill("SIGTERM"));

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const healthy = await fetch(`${publicUrl}/health`)
      .then((response) => response.ok)
      .catch(() => false);
    if (healthy) {
      break;
    }
    await sleep(250);
  }

  const mcpUrl = `${publicUrl}/mcp`;
  const unauthenticated = await fetch(mcpUrl, { method: "POST" });
  assert(
    unauthenticated.status === 401 &&
      unauthenticated.headers
        .get("www-authenticate")
        ?.includes(`${publicUrl}/.well-known/oauth-protected-resource`),
    `expected a 401 resource-metadata challenge, got ${unauthenticated.status}`
  );

  const { accessToken, dpopClient } = await requestRemoteToken(mcpUrl);
  const transport = new StreamableHTTPClientTransport(new URL(mcpUrl), {
    fetch: async (url, init) => {
      const request = new Request(url, init);
      const headers = new Headers(request.headers);
      headers.set("Authorization", `DPoP ${accessToken}`);
      headers.set(
        "DPoP",
        await dpopClient.proofFor(request.method, request.url, accessToken)
      );
      return fetch(new Request(request, { headers }));
    },
  });
  const client = new Client(
    { name: "zentity-e2e-smoke", version: "0.1.0" },
    clientOptions()
  );
  await client.connect(transport);
  return client;
}

async function runToolChecks(client: Client) {
  console.log("\n─── Tool surface ───");
  await step("tools/list", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name).sort();
    assert(
      JSON.stringify(names) === JSON.stringify(EXPECTED_TOOLS),
      `unexpected tools: ${names.join(", ")}`
    );
    assert(
      tools.every((tool) => tool.outputSchema),
      "every tool declares an output schema"
    );
    return `${tools.length} tools, protocol ${client.getNegotiatedProtocolVersion()}`;
  });

  if (!withAuth) {
    return;
  }

  console.log("\n─── Authenticated tools ───");
  await step("whoami", async () => {
    const summary = await callTool(client, "whoami", {});
    assert(typeof summary.tier === "number", "tier is a number");
    assert(typeof summary.tierName === "string", "tierName is a string");
    assert(typeof summary.loginMethod === "string", "loginMethod is set");
    assert(typeof summary.authStrength === "string", "authStrength is set");
    return `tier ${summary.tier} (${summary.tierName}), login ${summary.loginMethod}`;
  });

  await step("my_proofs", async () => {
    const proofs = await callTool(client, "my_proofs", {});
    assert(typeof proofs.verified === "boolean", "verified is a boolean");
    assert(Array.isArray(proofs.checks), "checks is an array");
    return `verified=${proofs.verified}, ${(proofs.checks as unknown[]).length} checks`;
  });

  await step("check_compliance", async () => {
    const compliance = await callTool(client, "check_compliance", {});
    assert(typeof compliance.attested === "boolean", "attested is a boolean");
    const networks = compliance.networks as Array<{ id: unknown }>;
    assert(Array.isArray(networks), "networks is an array");
    assert(
      networks.every((network) => typeof network.id === "string"),
      "every network has an id"
    );
    return `attested=${compliance.attested}, ${networks.length} networks`;
  });

  if (!withCiba) {
    return;
  }

  console.log("\n─── Approval-gated tools ───");
  await step("my_profile", async () => {
    const profile = await callUntilApproved(client, "my_profile", {
      fields: ["name"],
    });
    assert(profile.status === "complete", `status ${profile.status}`);
    const name = (profile.profile as { name?: { full?: unknown } }).name;
    assert(typeof name?.full === "string", "profile name is returned");
    return `name returned (${String(profile.returnedFields)})`;
  });

  await step("purchase", async () => {
    const purchase = await callUntilApproved(client, "purchase", {
      merchant: "Zentity Smoke Test",
      item: `Smoke widget ${new Date().toISOString()}`,
      amount: 1,
      currency: "USD",
    });
    assert(purchase.status === "complete", `status ${purchase.status}`);
    assert(purchase.approved === true, "purchase approved");
    const fulfillment = purchase.fulfillment as { name?: unknown } | null;
    assert(typeof fulfillment?.name === "string", "fulfillment name returned");
    return "approved with fulfillment data";
  });
}

async function main() {
  assert(
    transportName === "stdio" || transportName === "http",
    "--transport must be stdio or http"
  );
  assert(
    era === "legacy" || era === "modern",
    "--era must be legacy or modern"
  );

  const home = mkdtempSync(join(tmpdir(), "zentity-mcp-smoke-"));
  console.log("\nMCP server smoke test");
  console.log(`  Transport: ${transportName} (${era} era)`);
  console.log(`  Zentity:   ${zentityUrl}`);
  console.log(`  HOME:      ${home}`);
  const checks = ["surface"];
  if (withAuth) {
    checks.push("auth");
  }
  if (withCiba) {
    checks.push("approvals");
  }
  console.log(`  Checks:    ${checks.join(", ")}`);

  let client: Client | undefined;
  try {
    client =
      transportName === "http"
        ? await connectHttp(home)
        : await connectStdio(home);
    await runToolChecks(client);
  } catch (error) {
    failed++;
    const message = error instanceof Error ? error.message : String(error);
    console.log(`  ✗ connect: ${message}`);
  } finally {
    await client?.close();
    rmSync(home, { force: true, recursive: true });
  }

  console.log(`\n─── ${passed} passed, ${failed} failed ───\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
