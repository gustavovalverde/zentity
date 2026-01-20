import { auth } from "@/lib/auth/auth";

/**
 * OIDC4VCI credential issuer metadata endpoint.
 *
 * Enhances better-auth's metadata with token_endpoint for wallet compatibility.
 * Only SD-JWT credentials are advertised externally; BBS+ is used internally
 * for wallet binding (RFC-0020) but not exposed via OIDC4VCI.
 */
export async function GET(request: Request) {
  if (!auth.publicHandler) {
    return new Response("Not Found", { status: 404 });
  }

  const response = await auth.publicHandler(request);
  const metadata = await response.json();

  // Add token_endpoint directly for wallet compatibility (e.g., walt.id)
  // Some wallets expect token_endpoint in the credential issuer metadata
  const authServer =
    metadata.authorization_servers?.[0] ?? metadata.credential_issuer;

  const enhancedMetadata = {
    ...metadata,
    token_endpoint: `${authServer}/oauth2/token`,
  };

  return new Response(JSON.stringify(enhancedMetadata), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
