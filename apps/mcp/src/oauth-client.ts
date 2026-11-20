import { AGENT_BOOTSTRAP_SCOPES } from "@zentity/sdk/agent-contract";
import type { FirstPartyAuthDiscoveryDocument } from "@zentity/sdk/fpa";
import {
  buildLoopbackClientRegistration,
  createFirstPartyAuthFileStorage,
  createInstalledClientAuth,
  type InstalledClientAuth,
} from "@zentity/sdk/node";
import { config } from "./config.js";
import {
  type OAuthSessionContext,
  withDpopClient,
} from "./runtime/auth-context.js";

const LOOPBACK_REDIRECT_URI = "http://127.0.0.1/callback";
const MCP_SERVER_CLIENT_NAME = "@zentity/mcp-server";

// The login carries the bootstrap scopes, so agent registration exchanges a
// subset of the login's own scopes.
const INSTALLED_AGENT_LOGIN_SCOPES = [
  "openid",
  "email",
  "offline_access",
  "proof:identity",
  ...AGENT_BOOTSTRAP_SCOPES,
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
] as const;

const INSTALLED_AGENT_GRANT_TYPES = [
  "authorization_code",
  "refresh_token",
  "urn:openid:params:grant-type:ciba",
  "urn:ietf:params:oauth:grant-type:token-exchange",
] as const;

let cachedInstalledClientAuth: InstalledClientAuth | undefined;

function getMcpInstalledClientAuth(): InstalledClientAuth {
  if (!cachedInstalledClientAuth) {
    cachedInstalledClientAuth = createInstalledClientAuth({
      clientRegistrationRequest: buildLoopbackClientRegistration({
        clientName: MCP_SERVER_CLIENT_NAME,
        grantTypes: INSTALLED_AGENT_GRANT_TYPES,
        redirectUri: LOOPBACK_REDIRECT_URI,
        scope: INSTALLED_AGENT_REGISTRATION_SCOPES.join(" "),
      }),
      issuerUrl: config.zentityUrl,
      loginResource: config.zentityUrl,
      loginScope: INSTALLED_AGENT_LOGIN_SCOPES.join(" "),
      privateKeyJwt: true,
      ...(config.openBrowser
        ? {}
        : {
            openUrl: (url: string) => {
              console.error(`[auth] Open this URL to sign in: ${url}`);
            },
          }),
      storage: createFirstPartyAuthFileStorage({
        issuerUrl: config.zentityUrl,
        namespace: "mcp-server",
      }),
    });
  }

  return cachedInstalledClientAuth;
}

export function clearMcpOAuthTokens(): Promise<void> {
  return getMcpInstalledClientAuth().clearTokens();
}

export function discoverMcpOAuth(): Promise<FirstPartyAuthDiscoveryDocument> {
  return getMcpInstalledClientAuth().discover();
}

/** Exchanges the stored login token for a token limited to `scope`. */
export async function exchangeMcpLoginToken(options: {
  audience: string;
  scope: string;
}): Promise<string> {
  const { accessToken } =
    await getMcpInstalledClientAuth().exchangeLoginToken(options);
  return accessToken;
}

export async function ensureMcpOAuthSession(): Promise<OAuthSessionContext> {
  return withDpopClient(await getMcpInstalledClientAuth().ensureOAuthSession());
}

export async function refreshMcpOAuthSession(): Promise<OAuthSessionContext> {
  return withDpopClient(
    await getMcpInstalledClientAuth().refreshOAuthSession()
  );
}
