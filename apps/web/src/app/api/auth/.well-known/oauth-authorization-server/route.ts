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
 * Workaround endpoint for walt.id's RFC 8414 non-compliance
 *
 * RFC 8414 Section 3 specifies that for an issuer with a path component like
 * `http://server.example.com/some/path`, the metadata should be at:
 * `http://server.example.com/.well-known/oauth-authorization-server/some/path`
 *
 * However, walt.id incorrectly constructs the URL as:
 * `http://server.example.com/some/path/.well-known/oauth-authorization-server`
 *
 * This endpoint provides the OAuth AS metadata at the URL walt.id expects,
 * enabling interoperability until walt.id fixes their RFC 8414 implementation.
 *
 * @see https://www.rfc-editor.org/rfc/rfc8414#section-3
 * @see https://github.com/walt-id/waltid-identity (walt.id's non-compliant implementation)
 */
export async function GET(_request: Request) {
  if (!auth.publicHandler) {
    return new Response("Not Found", { status: 404 });
  }

  // Use environment-configured base URL (SSRF-safe: no request data flows to fetch)
  const baseUrl = getBaseUrl();

  // Fetch the metadata from the correct RFC 8414 location
  const metadataUrl = `${baseUrl}/.well-known/oauth-authorization-server/api/auth`;
  const response = await fetch(metadataUrl);

  if (!response.ok) {
    return new Response("Failed to fetch OAuth AS metadata", {
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
