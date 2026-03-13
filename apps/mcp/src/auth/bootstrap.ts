import { config } from "../config.js";
import { authenticateViaBrowser } from "./browser-redirect.js";
import { setDefaultAuth } from "./context.js";
import { loadCredentials } from "./credentials.js";
import { ensureClientRegistration } from "./dcr.js";
import { discover } from "./discovery.js";
import type { DpopKeyPair } from "./dpop.js";
import { getOrCreateDpopKey } from "./dpop.js";
import { generatePkce } from "./pkce.js";
import { TokenManager } from "./token-manager.js";

/**
 * Ensure the MCP server is authenticated before serving tool calls.
 *
 * 1. Discover Zentity's OAuth endpoints
 * 2. Register as an OAuth client (DCR) if needed
 * 3. Check for stored credentials — use them if valid
 * 4. If no credentials, open browser for OAuth login
 * 5. Set up the default auth context so tool handlers work
 * 6. Return a TokenManager for proactive refresh
 */
export async function ensureAuthenticated(): Promise<TokenManager> {
  const discovery = await discover(config.zentityUrl);
  const clientId = await ensureClientRegistration(discovery);
  const dpopKey = await getOrCreateDpopKey(config.zentityUrl);

  const tokenManager = new TokenManager(
    discovery.token_endpoint,
    dpopKey,
    clientId,
    config.zentityUrl
  );

  // Check if we already have valid credentials
  const creds = loadCredentials(config.zentityUrl);
  if (creds?.accessToken || creds?.refreshToken) {
    try {
      const accessToken = await tokenManager.getAccessToken();
      setDefaultAuth({
        accessToken,
        clientId,
        dpopKey,
        loginHint: creds.loginHint ?? "",
      });
      console.error("[auth] Using stored credentials");
      return tokenManager;
    } catch {
      console.error("[auth] Stored credentials expired, re-authenticating...");
    }
  }

  // No valid credentials — authenticate via browser
  const pkce = await generatePkce();
  const result = await authenticateViaBrowser({
    authorizeEndpoint: discovery.authorization_endpoint,
    parEndpoint: discovery.pushed_authorization_request_endpoint,
    tokenEndpoint: discovery.token_endpoint,
    clientId,
    dpopKey,
    pkce,
    resource: config.zentityUrl,
  });

  setDefaultAuth({
    accessToken: result.accessToken,
    clientId,
    dpopKey,
    loginHint: result.loginHint ?? "",
  });

  console.error("[auth] Authentication complete");
  return tokenManager;
}

/**
 * Refresh the default auth context with a fresh access token.
 */
export async function refreshAuthContext(
  tokenManager: TokenManager,
  clientId: string,
  dpopKey: DpopKeyPair
): Promise<void> {
  const accessToken = await tokenManager.getAccessToken();
  const creds = loadCredentials(config.zentityUrl);
  setDefaultAuth({
    accessToken,
    clientId,
    dpopKey,
    loginHint: creds?.loginHint ?? "",
  });
}
