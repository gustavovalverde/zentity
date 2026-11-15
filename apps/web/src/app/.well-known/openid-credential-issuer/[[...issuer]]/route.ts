import { metadataResponse } from "@better-auth/oauth-provider";

import { auth } from "@/lib/auth/auth-config";
import {
  DEFAULT_AUTH_BASE_PATH,
  issuerPathMatches,
} from "@/lib/auth/oidc/well-known";

const CREDENTIAL_SCOPE = "identity_verification";

/**
 * OIDC4VCI credential issuer metadata endpoint.
 *
 * Adds to the oidc4vci plugin's document:
 * - token_endpoint for wallet compatibility (e.g., walt.id)
 * - scope per credential configuration per HAIP §4.1, advertised here rather
 *   than configured on the plugin (see `oidc4vciCredentialConfigurations`)
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

  const metadata = await auth.api.getCredentialIssuerMetadata();
  const authServer =
    metadata.authorization_servers?.[0] ?? metadata.credential_issuer;

  return metadataResponse({
    ...metadata,
    token_endpoint: `${authServer}/oauth2/token`,
    credential_configurations_supported: Object.fromEntries(
      Object.entries(metadata.credential_configurations_supported).map(
        ([id, config]) => [
          id,
          { ...config, scope: config.scope || CREDENTIAL_SCOPE },
        ]
      )
    ),
  });
}
