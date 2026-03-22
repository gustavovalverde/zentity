import { auth } from "@/lib/auth/auth";
import { getAuthIssuer } from "@/lib/auth/issuer";
import {
  buildWellKnownResponse,
  callAuthApi,
  DEFAULT_AUTH_BASE_PATH,
  issuerPathMatches,
  unwrapMetadata,
} from "@/lib/auth/well-known-utils";

/**
 * OIDC4VCI credential issuer metadata endpoint.
 *
 * Enhances better-auth's metadata with:
 * - token_endpoint for wallet compatibility (e.g., walt.id)
 * - nonce_endpoint per HAIP §4.1 (required when key binding is supported)
 * - scope per credential configuration per HAIP §4.1
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ issuer?: string[] }> }
) {
  const { issuer: issuerSegments } = await params;
  const requestedPath = issuerSegments?.join("/") ?? "";

  if (!issuerPathMatches(requestedPath, DEFAULT_AUTH_BASE_PATH)) {
    return new Response("Not Found", { status: 404 });
  }

  const metadata = unwrapMetadata(
    await callAuthApi(auth.api, "getCredentialIssuerMetadata")
  ) as Record<string, unknown>;

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
        config.scope = "identity_verification";
      }
    }
  }

  const enhancedMetadata = {
    ...metadata,
    token_endpoint: `${authServer}/oauth2/token`,
    nonce_endpoint: `${issuer}/oidc4vci/nonce`,
    ...(configs ? { credential_configurations_supported: configs } : {}),
  };

  return buildWellKnownResponse(enhancedMetadata);
}
