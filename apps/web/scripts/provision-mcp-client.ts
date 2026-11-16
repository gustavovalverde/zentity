#!/usr/bin/env tsx

/**
 * Creates or updates the confidential OAuth client the MCP HTTP server
 * authenticates as, and links it to `MCP_PUBLIC_URL`, through the OAuth
 * provider's administration APIs. Safe to re-run.
 *
 *   pnpm mcp:provision [--write-env <path>] [--rotate-secret]
 *
 * The client to update is `MCP_CLIENT_ID` from the environment, else from the
 * `--write-env` file. Without one, a new client is created. The secret is
 * printed only when the client is created or `--rotate-secret` is passed.
 * `--write-env` writes `MCP_CLIENT_ID` (and a new `MCP_CLIENT_SECRET`) into
 * that file, keeping its other lines.
 *
 * Runs with `--conditions=react-server`, so modules marked `server-only`
 * load outside Next. It needs the web app's environment (`.env` locally, or
 * `railway run --service web` against production).
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { provisionMcpClient } from "@/lib/auth/oidc/mcp-client";

const ENV_LINE = /^([A-Z0-9_]+)=(.*)$/;
const ENV_KEY = /^([A-Z0-9_]+)=/;
const TRAILING_NEWLINE = /\n$/;

function readEnvFile(path: string): Map<string, string> {
  const values = new Map<string, string>();
  if (!existsSync(path)) {
    return values;
  }
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = ENV_LINE.exec(line.trim());
    if (match?.[1]) {
      values.set(match[1], match[2] ?? "");
    }
  }
  return values;
}

function writeEnvFile(path: string, updates: Record<string, string>): void {
  const lines = existsSync(path)
    ? readFileSync(path, "utf8").replace(TRAILING_NEWLINE, "").split("\n")
    : [];
  const pending = new Map(Object.entries(updates));
  const merged = lines.map((line) => {
    const key = ENV_KEY.exec(line)?.[1];
    const value = key ? pending.get(key) : undefined;
    if (key && value !== undefined) {
      pending.delete(key);
      return `${key}=${value}`;
    }
    return line;
  });
  for (const [key, value] of pending) {
    merged.push(`${key}=${value}`);
  }
  writeFileSync(path, `${merged.join("\n")}\n`, { mode: 0o600 });
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      "rotate-secret": { type: "boolean", default: false },
      "write-env": { type: "string" },
    },
  });
  const envPath = values["write-env"]
    ? resolve(process.cwd(), values["write-env"])
    : undefined;
  const clientId =
    process.env.MCP_CLIENT_ID ||
    (envPath ? readEnvFile(envPath).get("MCP_CLIENT_ID") : undefined) ||
    undefined;

  const credentials = await provisionMcpClient({
    clientId,
    rotateSecret: values["rotate-secret"],
  });

  console.log(
    credentials.created
      ? "Created the MCP HTTP client."
      : "Updated the MCP HTTP client."
  );
  console.log(`MCP_CLIENT_ID=${credentials.clientId}`);
  if (credentials.clientSecret) {
    console.log(`MCP_CLIENT_SECRET=${credentials.clientSecret}`);
    console.log("Store the secret now; it is not shown again.");
  }
  if (envPath) {
    writeEnvFile(envPath, {
      MCP_CLIENT_ID: credentials.clientId,
      ...(credentials.clientSecret
        ? { MCP_CLIENT_SECRET: credentials.clientSecret }
        : {}),
    });
    console.log(`Wrote ${envPath}.`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
