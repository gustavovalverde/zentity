import { auth } from "@/lib/auth/auth";

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
export async function GET(request: Request) {
  if (!auth.publicHandler) {
    return new Response("Not Found", { status: 404 });
  }

  const url = new URL(request.url);
  const baseUrl = `${url.protocol}//${url.host}`;

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
