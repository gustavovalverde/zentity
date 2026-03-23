import { config } from "../config.js";
import { authenticateViaBrowser } from "./browser-redirect.js";
import type { OAuthSessionContext } from "./context.js";
import { clearClientRegistration, loadCredentials } from "./credentials.js";
import { ensureClientRegistration } from "./dcr.js";
import { discover } from "./discovery.js";
import {
  getOrCreateDpopKey,
  type DpopKeyPair,
} from "./dpop.js";
import { generatePkce } from "./pkce.js";
import { exchangeToken } from "./token-exchange.js";
import { TokenManager } from "./token-manager.js";

export interface AuthBootstrapResult {
  oauth: OAuthSessionContext;
  tokenManager: TokenManager;
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
): Promise<string> {
  const { accessToken } = await exchangeToken({
    tokenEndpoint: discovery.token_endpoint,
    subjectToken,
    audience: config.zentityUrl,
    clientId,
    dpopKey,
  });

  return accessToken;
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
  const tokenManager = new TokenManager(
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
    });
    const appAccessToken = await exchangeAppAccessToken(
      discovery,
      result.accessToken,
      activeClientId,
      dpopKey
    );

    return {
      oauth: {
        accessToken: appAccessToken,
        clientId: activeClientId,
        dpopKey,
        loginHint: result.loginHint ?? "",
      },
      tokenManager,
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
 * 5. Return OAuth context plus a TokenManager for proactive refresh
 */
export async function ensureAuthenticated(): Promise<AuthBootstrapResult> {
  const discovery = await discover(config.zentityUrl);
  const clientId = await ensureClientRegistration(discovery);
  const dpopKey = await getOrCreateDpopKey(config.zentityUrl);

  const tokenManager = new TokenManager(
    discovery.token_endpoint,
    dpopKey,
    clientId
  );

  // Check if we already have valid credentials
  const creds = loadCredentials(config.zentityUrl);
  if (creds?.accessToken || creds?.refreshToken) {
    try {
      const loginAccessToken = await tokenManager.getAccessToken();
      const accessToken = await exchangeAppAccessToken(
        discovery,
        loginAccessToken,
        clientId,
        dpopKey
      );
      const oauth: OAuthSessionContext = {
        accessToken,
        clientId,
        dpopKey,
        loginHint: creds.loginHint ?? "",
      };
      console.error("[auth] Using stored credentials");
      return { oauth, tokenManager };
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
  const { oauth, tokenManager: freshTokenManager } =
    await authenticateFreshSession(discovery, dpopKey, clientId);
  console.error("[auth] Authentication complete");
  return { oauth, tokenManager: freshTokenManager };
}

/**
 * Refresh the OAuth session context with a fresh access token.
 */
export async function refreshAuthContext(
  tokenManager: TokenManager,
  oauth: Pick<OAuthSessionContext, "clientId" | "dpopKey" | "loginHint">
): Promise<OAuthSessionContext> {
  const discovery = await discover(config.zentityUrl);
  const loginAccessToken = await tokenManager.getAccessToken();
  const accessToken = await exchangeAppAccessToken(
    discovery,
    loginAccessToken,
    oauth.clientId,
    oauth.dpopKey
  );
  const creds = loadCredentials(config.zentityUrl);
  return {
    accessToken,
    clientId: oauth.clientId,
    dpopKey: oauth.dpopKey,
    loginHint: creds?.loginHint ?? oauth.loginHint,
  };
}
