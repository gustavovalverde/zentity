import { randomBytes } from "node:crypto";

const args = process.argv.slice(2);
const DEFAULT_MCP_PORT = "3300";
const MIN_DPOP_NONCE_SECRET_LENGTH = 32;

function getArg(name: string, fallback: string): string {
  const index = args.indexOf(`--${name}`);
  if (index !== -1 && index + 1 < args.length) {
    const value = args[index + 1];
    if (value !== undefined) {
      return value;
    }
  }
  return fallback;
}

const port = Number.parseInt(getArg("port", DEFAULT_MCP_PORT), 10);

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

export const config = {
  transport: getArg("transport", "stdio") as "stdio" | "http",
  port,
  zentityUrl: process.env.ZENTITY_URL ?? "http://localhost:3000",
  mcpPublicUrl: process.env.MCP_PUBLIC_URL ?? `http://localhost:${port}`,
  openBrowser: process.env.ZENTITY_MCP_NO_BROWSER !== "1",
  allowedOrigins: (
    process.env.MCP_ALLOWED_ORIGINS ?? "http://localhost:*,http://127.0.0.1:*"
  ).split(","),
  dpopNonceSecret: resolveDpopNonceSecret(process.env.MCP_DPOP_NONCE_SECRET),
};
