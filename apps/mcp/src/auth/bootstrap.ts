import { config } from "../config.js";
import { AccessTokenProvider } from "./access-token-provider.js";
import { authenticateViaBrowser } from "./browser-redirect.js";
import type { OAuthSessionContext } from "./context.js";
import { clearClientRegistration, loadCredentials } from "./credentials.js";
import { ensureClientRegistration } from "./dcr.js";
import { discover } from "./discovery.js";
import { type DpopKeyPair, getOrCreateDpopKey } from "./dpop.js";
import { generatePkce } from "./pkce.js";
import { exchangeToken } from "./token-exchange.js";

export interface AuthBootstrapResult {
  accessTokenProvider: AccessTokenProvider;
  oauth: OAuthSessionContext;
}

function isInvalidClientError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("invalid_client") || message.includes("client not found")
  );
}

async function exchangeAppAccessToken(
  discovery: Awaited<ReturnType<typeof discover>>,
  subjectToken: string,
  clientId: string,
  dpopKey: DpopKeyPair
): Promise<{ accessToken: string; scopes: string[] }> {
  const { accessToken, scope } = await exchangeToken({
    tokenEndpoint: discovery.token_endpoint,
    subjectToken,
    audience: config.zentityUrl,
    clientId,
    dpopKey,
  });

  return {
    accessToken,
    scopes: typeof scope === "string" ? scope.split(" ").filter(Boolean) : [],
  };
}

async function authenticateFreshSession(
  discovery: Awaited<ReturnType<typeof discover>>,
  dpopKey: DpopKeyPair,
  clientId: string,
  forceClientRegistration = false
): Promise<AuthBootstrapResult> {
  const activeClientId = forceClientRegistration
    ? await ensureClientRegistration(discovery, {
        force: true,
      })
    : clientId;
  const accessTokenProvider = new AccessTokenProvider(
    discovery.token_endpoint,
    dpopKey,
    activeClientId
  );
  const pkce = await generatePkce();
  const parEndpoint = discovery.pushed_authorization_request_endpoint;

  try {
    const result = await authenticateViaBrowser({
      authorizeEndpoint: discovery.authorization_endpoint,
      ...(parEndpoint ? { parEndpoint } : {}),
      tokenEndpoint: discovery.token_endpoint,
      clientId: activeClientId,
      dpopKey,
      pkce,
      resource: config.zentityUrl,
    });
    const appAuth = await exchangeAppAccessToken(
      discovery,
      result.accessToken,
      activeClientId,
      dpopKey
    );

    return {
      oauth: {
        accessToken: appAuth.accessToken,
        accountSub: result.accountSub ?? "",
        clientId: activeClientId,
        dpopKey,
        loginHint: result.loginHint ?? "",
        scopes: appAuth.scopes,
      },
      accessTokenProvider,
    };
  } catch (error) {
    if (!forceClientRegistration && isInvalidClientError(error)) {
      console.error(
        "[dcr] Cached client registration is stale, re-registering OAuth client..."
      );
      clearClientRegistration(config.zentityUrl);
      return authenticateFreshSession(discovery, dpopKey, clientId, true);
    }
    throw error;
  }
}

/**
 * Ensure the MCP server is authenticated before serving tool calls.
 *
 * 1. Discover Zentity's OAuth endpoints
 * 2. Register as an OAuth client (DCR) if needed
 * 3. Check for stored credentials — use them if valid
 * 4. If no credentials, open browser for OAuth login
 * 5. Return OAuth context plus an access-token provider for proactive refresh
 */
export async function ensureAuthenticated(): Promise<AuthBootstrapResult> {
  const discovery = await discover(config.zentityUrl);
  const clientId = await ensureClientRegistration(discovery);
  const dpopKey = await getOrCreateDpopKey(config.zentityUrl);

  const accessTokenProvider = new AccessTokenProvider(
    discovery.token_endpoint,
    dpopKey,
    clientId
  );

  // Check if we already have valid credentials
  const creds = loadCredentials(config.zentityUrl);
  if (creds?.accessToken || creds?.refreshToken) {
    try {
      const loginAccessToken = await accessTokenProvider.getAccessToken();
      const appAuth = await exchangeAppAccessToken(
        discovery,
        loginAccessToken,
        clientId,
        dpopKey
      );
      const oauth: OAuthSessionContext = {
        accessToken: appAuth.accessToken,
        accountSub: creds.accountSub ?? "",
        clientId,
        dpopKey,
        loginHint: creds.loginHint ?? "",
        scopes: appAuth.scopes,
      };
      console.error("[auth] Using stored credentials");
      return { oauth, accessTokenProvider };
    } catch (error) {
      if (isInvalidClientError(error)) {
        console.error(
          "[dcr] Stored client registration is stale, re-registering OAuth client..."
        );
        clearClientRegistration(config.zentityUrl);
      }
      console.error("[auth] Stored credentials expired, re-authenticating...");
    }
  }

  // No valid credentials — authenticate via browser
  const { oauth, accessTokenProvider: freshAccessTokenProvider } =
    await authenticateFreshSession(discovery, dpopKey, clientId);
  console.error("[auth] Authentication complete");
  return { oauth, accessTokenProvider: freshAccessTokenProvider };
}

/**
 * Refresh the OAuth session context with a fresh access token.
 */
export async function refreshAuthContext(
  accessTokenProvider: AccessTokenProvider,
  oauth: Pick<
    OAuthSessionContext,
    "accountSub" | "clientId" | "dpopKey" | "loginHint"
  >
): Promise<OAuthSessionContext> {
  const discovery = await discover(config.zentityUrl);
  const loginAccessToken = await accessTokenProvider.getAccessToken();
  const appAuth = await exchangeAppAccessToken(
    discovery,
    loginAccessToken,
    oauth.clientId,
    oauth.dpopKey
  );
  const creds = loadCredentials(config.zentityUrl);
  return {
    accessToken: appAuth.accessToken,
    accountSub: creds?.accountSub ?? oauth.accountSub,
    clientId: oauth.clientId,
    dpopKey: oauth.dpopKey,
    loginHint: creds?.loginHint ?? oauth.loginHint,
    scopes: appAuth.scopes,
  };
}
