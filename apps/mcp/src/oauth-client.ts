import type { FirstPartyAuthDiscoveryDocument } from "@zentity/sdk/fpa";
import {
  buildLoopbackClientRegistration,
  buildOAuthClientMetadata,
  createFirstPartyAuthFileStorage,
  createInstalledClientAuth,
  type InstalledClientAuth,
  type InstalledClientCredentials,
  type InstalledOAuthSession,
  normalizeUrl,
} from "@zentity/sdk/node";
import { config } from "./config.js";
import { RUNTIME_BOOTSTRAP_SCOPES } from "./runtime/bootstrap-scopes.js";

const LOOPBACK_REDIRECT_URI = "http://127.0.0.1/callback";
const CLIENT_METADATA_PATH = "/.well-known/oauth-client.json";
const MCP_SERVER_CLIENT_NAME = "@zentity/mcp-server";
const REMOTE_MCP_DEFAULT_SCOPE = "openid";
const PROTECTED_RESOURCE_METADATA_FIELD = "zentity_protected_resource";

const INSTALLED_AGENT_LOGIN_SCOPES = [
  "openid",
  "email",
  "offline_access",
  "proof:identity",
] as const;

const INSTALLED_AGENT_CIBA_SCOPES = [
  "identity.name",
  "identity.address",
  "identity.dob",
  "proof:age",
  "proof:nationality",
] as const;

const INSTALLED_AGENT_REGISTRATION_SCOPES = [
  ...INSTALLED_AGENT_LOGIN_SCOPES,
  ...INSTALLED_AGENT_CIBA_SCOPES,
  ...RUNTIME_BOOTSTRAP_SCOPES,
] as const;

const REMOTE_CLIENT_GRANT_TYPES = [
  "authorization_code",
  "refresh_token",
  "urn:openid:params:grant-type:ciba",
] as const;

const INSTALLED_AGENT_GRANT_TYPES = [
  ...REMOTE_CLIENT_GRANT_TYPES,
  "urn:ietf:params:oauth:grant-type:token-exchange",
] as const;

let cachedInstalledClientAuth: InstalledClientAuth | undefined;

function getMcpInstalledClientAuth(): InstalledClientAuth {
  if (!cachedInstalledClientAuth) {
    cachedInstalledClientAuth = createInstalledClientAuth({
      clientRegistrationRequest: {
        ...buildLoopbackClientRegistration({
          clientName: MCP_SERVER_CLIENT_NAME,
          grantTypes: INSTALLED_AGENT_GRANT_TYPES,
          redirectUri: LOOPBACK_REDIRECT_URI,
          scope: INSTALLED_AGENT_REGISTRATION_SCOPES.join(" "),
        }),
        [PROTECTED_RESOURCE_METADATA_FIELD]: normalizeUrl(config.mcpPublicUrl),
      },
      issuerUrl: config.zentityUrl,
      loginResource: config.zentityUrl,
      loginScope: INSTALLED_AGENT_LOGIN_SCOPES.join(" "),
      storage: createFirstPartyAuthFileStorage({
        issuerUrl: config.zentityUrl,
        namespace: "mcp-server",
      }),
      tokenExchangeAudience: config.zentityUrl,
    });
  }

  return cachedInstalledClientAuth;
}

export function buildMcpRemoteClientMetadata(): Record<string, unknown> {
  return buildOAuthClientMetadata({
    clientId: `${normalizeUrl(config.mcpPublicUrl)}${CLIENT_METADATA_PATH}`,
    clientName: MCP_SERVER_CLIENT_NAME,
    grantTypes: REMOTE_CLIENT_GRANT_TYPES,
    redirectUris: [LOOPBACK_REDIRECT_URI],
    scope: REMOTE_MCP_DEFAULT_SCOPE,
  });
}

export function clearMcpOAuthTokens(): Promise<void> {
  return getMcpInstalledClientAuth().clearTokens();
}

export function discoverMcpOAuth(): Promise<FirstPartyAuthDiscoveryDocument> {
  return getMcpInstalledClientAuth().discover();
}

export function ensureMcpOAuthClientCredentials(options?: {
  forceClientRegistration?: boolean;
}): Promise<InstalledClientCredentials> {
  return getMcpInstalledClientAuth().ensureClientCredentials(options);
}

export function ensureMcpOAuthSession(): Promise<InstalledOAuthSession> {
  return getMcpInstalledClientAuth().ensureOAuthSession();
}

export function getCachedMcpOAuthIssuer(): string | undefined {
  return getMcpInstalledClientAuth().getCachedIssuer();
}

export function getCachedMcpOAuthJwksUri(): string | undefined {
  return getMcpInstalledClientAuth().getCachedJwksUri();
}

export function refreshMcpOAuthSession(): Promise<InstalledOAuthSession> {
  return getMcpInstalledClientAuth().refreshOAuthSession();
}
