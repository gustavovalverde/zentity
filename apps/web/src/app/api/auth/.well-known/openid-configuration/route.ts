import { auth } from "@/lib/auth/auth";

const AUTH_PATH_SUFFIX = /\/api\/auth$/;

/**
 * Get the base URL from environment variables (SSRF-safe - no request data used).
 * Falls back to localhost for development.
 */
function getBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.BETTER_AUTH_URL?.replace(AUTH_PATH_SUFFIX, "") ||
    "http://localhost:3000"
  );
}

/**
 * Workaround endpoint for walt.id's well-known URL construction
 *
 * Similar to the oauth-authorization-server workaround, walt.id constructs
 * the openid-configuration URL incorrectly for issuers with path components.
 *
 * Walt.id expects: `/api/auth/.well-known/openid-configuration`
 * RFC requires: `/.well-known/openid-configuration/api/auth` (or just `/.well-known/openid-configuration`)
 *
 * @see https://openid.net/specs/openid-connect-discovery-1_0.html
 */
export async function GET(_request: Request) {
  if (!auth.publicHandler) {
    return new Response("Not Found", { status: 404 });
  }

  // Use environment-configured base URL (SSRF-safe: no request data flows to fetch)
  const baseUrl = getBaseUrl();

  // Fetch from the correct OpenID Connect discovery location
  const metadataUrl = `${baseUrl}/.well-known/openid-configuration`;
  const response = await fetch(metadataUrl);

  if (!response.ok) {
    return new Response("Failed to fetch OpenID configuration", {
      status: response.status,
    });
  }

  const metadata = await response.json();

  return new Response(JSON.stringify(metadata), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
