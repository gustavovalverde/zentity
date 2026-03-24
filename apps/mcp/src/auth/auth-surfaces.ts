import { INSTALLED_AGENT_LOGIN_SCOPE_STRING } from "./installed-agent-scopes.js";

const LOOPBACK_REDIRECT_URI = "http://127.0.0.1/callback";
const MCP_SERVER_CLIENT_NAME = "@zentity/mcp-server";
const OAUTH_CLIENT_METADATA_PATH = "/.well-known/oauth-client.json";
const REMOTE_MCP_DEFAULT_SCOPE_STRING = "openid";

const INSTALLED_AGENT_GRANT_TYPES = [
  "authorization_code",
  "refresh_token",
  "urn:openid:params:grant-type:ciba",
  "urn:ietf:params:oauth:grant-type:token-exchange",
] as const;

const REMOTE_CLIENT_GRANT_TYPES = [
  "authorization_code",
  "refresh_token",
] as const;

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(
      ([left], [right]) => left.localeCompare(right)
    );
    return `{${entries
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

function normalizeUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function buildRemoteOAuthClientId(mcpPublicUrl: string): string {
  return `${normalizeUrl(mcpPublicUrl)}${OAUTH_CLIENT_METADATA_PATH}`;
}

export function buildInstalledAgentRegistrationRequest(): Record<
  string,
  unknown
> {
  return {
    client_name: MCP_SERVER_CLIENT_NAME,
    redirect_uris: [LOOPBACK_REDIRECT_URI],
    scope: INSTALLED_AGENT_LOGIN_SCOPE_STRING,
    token_endpoint_auth_method: "none",
    grant_types: [...INSTALLED_AGENT_GRANT_TYPES],
    response_types: ["code"],
  };
}

export function getInstalledAgentRegistrationFingerprint(): string {
  return stableStringify(buildInstalledAgentRegistrationRequest());
}

export function buildRemoteOAuthClientMetadata(
  mcpPublicUrl: string
): Record<string, unknown> {
  return {
    client_id: buildRemoteOAuthClientId(mcpPublicUrl),
    client_name: MCP_SERVER_CLIENT_NAME,
    redirect_uris: [LOOPBACK_REDIRECT_URI],
    grant_types: [...REMOTE_CLIENT_GRANT_TYPES],
    token_endpoint_auth_method: "none",
    // Keep the default remote grant minimal. Tool-specific scopes are
    // requested later through insufficient_scope challenges.
    scope: REMOTE_MCP_DEFAULT_SCOPE_STRING,
  };
}
