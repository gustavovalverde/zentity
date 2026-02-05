/**
 * OAuth Post-Login Flow
 *
 * Handles the continuation of OAuth authorization flows after custom authentication
 * (passkey, OPAQUE, SIWE). These auth methods don't natively integrate with the
 * oauth-provider plugin, so after session creation, we must explicitly call the
 * continue endpoint to get the redirect URL to the consent page.
 *
 * The oauthProviderClient plugin automatically injects the signed oauth_query from
 * window.location.search into the continue request.
 */
import { authClient } from "@/lib/auth/auth-client";

/**
 * Check if the current page has OAuth authorization parameters.
 * The authorize endpoint adds a signed `sig` param to the URL when redirecting
 * to the login page.
 */
export function hasOAuthParams(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  const params = new URLSearchParams(window.location.search);
  return params.has("sig") && params.has("client_id");
}

/**
 * Extract the signed OAuth query string (up to and including `sig`).
 * Mirrors Better Auth's oauthProviderClient behavior.
 */
export function getSignedOAuthQuery(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  const params = new URLSearchParams(window.location.search);
  if (!params.has("sig")) {
    return null;
  }
  const signedParams = new URLSearchParams();
  for (const [key, value] of params.entries()) {
    signedParams.append(key, value);
    if (key === "sig") {
      break;
    }
  }
  return signedParams.toString();
}

/**
 * Continue the OAuth flow after custom authentication.
 * Call this after successful passkey/OPAQUE/SIWE auth when hasOAuthParams() is true.
 *
 * @returns The redirect URL to the consent page, or null if not in an OAuth flow
 */
export async function continueOAuthFlow(): Promise<string | null> {
  if (!hasOAuthParams()) {
    return null;
  }

  const response = await authClient.oauth2.continue({
    postLogin: true,
  });

  if (response.error || !response.data) {
    throw new Error(response.error?.message || "Failed to continue OAuth flow");
  }

  const data = response.data as { redirect?: boolean; uri?: string };
  if (data.redirect && data.uri) {
    return data.uri;
  }

  return null;
}

/**
 * Get the post-authentication redirect URL.
 * Handles both OAuth flows (returns consent page URL) and normal flows (returns fallback).
 *
 * @param fallbackUrl - URL to redirect to if not in an OAuth flow (default: /dashboard)
 * @returns The appropriate redirect URL
 */
export async function getPostAuthRedirectUrl(
  fallbackUrl = "/dashboard"
): Promise<string> {
  const oauthRedirect = await continueOAuthFlow();
  return oauthRedirect ?? fallbackUrl;
}
