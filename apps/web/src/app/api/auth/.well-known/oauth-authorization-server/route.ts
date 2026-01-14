import { auth } from "@/lib/auth/auth";

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
export async function GET(request: Request) {
  if (!auth.publicHandler) {
    return new Response("Not Found", { status: 404 });
  }

  // Forward to better-auth's OAuth AS metadata endpoint
  // The actual metadata is served by the [[...all]] catch-all route
  const url = new URL(request.url);
  const baseUrl = `${url.protocol}//${url.host}`;

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
