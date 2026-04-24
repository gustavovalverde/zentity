import { config } from "../config.js";
import { getRemoteMcpScopesSupported } from "./remote-scope-policy.js";

const TRAILING_SLASHES = /\/+$/;
const LEADING_SLASHES = /^\/+/;

function normalizeUrl(value: string): string {
  return value.replace(TRAILING_SLASHES, "");
}

function joinUrlPath(base: string, path: string): string {
  const url = new URL(normalizeUrl(base));
  const basePath = url.pathname.replace(TRAILING_SLASHES, "");
  const suffix = path.replace(LEADING_SLASHES, "");
  url.pathname = `${basePath}/${suffix}`.replace(/\/{2,}/g, "/");
  url.search = "";
  url.hash = "";
  return normalizeUrl(url.toString());
}

export function getResourceMetadata(): Record<string, unknown> {
  return {
    resource: config.mcpPublicUrl,
    authorization_servers: [joinUrlPath(config.zentityUrl, "/api/auth")],
    scopes_supported: getRemoteMcpScopesSupported(),
    bearer_methods_supported: ["header", "dpop"],
  };
}
