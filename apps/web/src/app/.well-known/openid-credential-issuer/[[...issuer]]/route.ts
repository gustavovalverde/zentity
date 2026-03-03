import { auth } from "@/lib/auth/auth";
import { getAuthIssuer } from "@/lib/auth/issuer";

/**
 * OIDC4VCI credential issuer metadata endpoint.
 *
 * Enhances better-auth's metadata with:
 * - token_endpoint for wallet compatibility (e.g., walt.id)
 * - nonce_endpoint per HAIP §4.1 (required when key binding is supported)
 * - scope per credential configuration per HAIP §4.1
 */
export async function GET(request: Request) {
  if (!auth.publicHandler) {
    return new Response("Not Found", { status: 404 });
  }

  const response = await auth.publicHandler(request);
  const metadata = (await response.json()) as Record<string, unknown>;

  const authServer =
    (metadata.authorization_servers as string[] | undefined)?.[0] ??
    (metadata.credential_issuer as string);
  const issuer = getAuthIssuer();

  // HAIP §4.1: credential configurations MUST include scope
  const configs = metadata.credential_configurations_supported as
    | Record<string, Record<string, unknown>>
    | undefined;
  if (configs) {
    for (const config of Object.values(configs)) {
      if (!config.scope) {
        config.scope = "zentity_identity";
      }
    }
  }

  const enhancedMetadata = {
    ...metadata,
    token_endpoint: `${authServer}/oauth2/token`,
    nonce_endpoint: `${issuer}/oidc4vci/nonce`,
    ...(configs ? { credential_configurations_supported: configs } : {}),
  };

  return new Response(JSON.stringify(enhancedMetadata), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
