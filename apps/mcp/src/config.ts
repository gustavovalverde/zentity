import { randomBytes } from "node:crypto";
import { parseArgs } from "node:util";

const DEFAULT_MCP_PORT = 3300;
const MIN_DPOP_NONCE_SECRET_LENGTH = 32;
const DECIMAL_INTEGER_RE = /^\d+$/;

/** Reads `--transport` and `--port` (also as `--port=3300`); other flags are ignored. */
export function parseCliArgs(args: string[]): {
  port: number;
  transport: "stdio" | "http";
} {
  const { values } = parseArgs({
    args,
    options: { port: { type: "string" }, transport: { type: "string" } },
    strict: false,
  });

  const transport = values.transport ?? "stdio";
  if (transport !== "stdio" && transport !== "http") {
    throw new Error(
      `--transport must be "stdio" or "http", got "${transport}"`
    );
  }

  const port =
    values.port === undefined ? DEFAULT_MCP_PORT : Number(values.port);
  if (
    values.port !== undefined &&
    (typeof values.port !== "string" ||
      !DECIMAL_INTEGER_RE.test(values.port) ||
      port > 65_535)
  ) {
    throw new Error(`--port must be a port number, got "${values.port}"`);
  }

  return { port, transport };
}

const { port, transport } = parseCliArgs(process.argv.slice(2));

/**
 * The secret the HTTP transport derives its DPoP nonces from. Without
 * `MCP_DPOP_NONCE_SECRET`, each process generates its own, which suits a single
 * instance: every instance behind one URL must share the value, or each
 * rejects the nonces the others issue.
 */
export function resolveDpopNonceSecret(value: string | undefined): string {
  if (!value) {
    return randomBytes(32).toString("base64url");
  }
  if (value.length < MIN_DPOP_NONCE_SECRET_LENGTH) {
    throw new Error(
      `MCP_DPOP_NONCE_SECRET must be at least ${MIN_DPOP_NONCE_SECRET_LENGTH} characters`
    );
  }
  return value;
}

/**
 * The confidential client MCP HTTP authenticates to Zentity as. Provisioned
 * by `pnpm mcp:provision` in apps/web, which prints both values.
 */
export function requireHttpClientCredentials(env: {
  MCP_CLIENT_ID?: string | undefined;
  MCP_CLIENT_SECRET?: string | undefined;
}): { clientId: string; clientSecret: string } {
  const clientId = env.MCP_CLIENT_ID;
  const clientSecret = env.MCP_CLIENT_SECRET;
  if (!(clientId && clientSecret)) {
    throw new Error(
      "The HTTP transport needs MCP_CLIENT_ID and MCP_CLIENT_SECRET. Run `pnpm mcp:provision` in apps/web to create them."
    );
  }
  return { clientId, clientSecret };
}

export const config = {
  transport,
  port,
  zentityUrl: process.env.ZENTITY_URL ?? "http://localhost:3000",
  mcpPublicUrl: process.env.MCP_PUBLIC_URL ?? `http://localhost:${port}`,
  openBrowser: process.env.ZENTITY_MCP_NO_BROWSER !== "1",
  allowedOrigins: (
    process.env.MCP_ALLOWED_ORIGINS ?? "http://localhost:*,http://127.0.0.1:*"
  ).split(","),
  dpopNonceSecret: resolveDpopNonceSecret(process.env.MCP_DPOP_NONCE_SECRET),
};
