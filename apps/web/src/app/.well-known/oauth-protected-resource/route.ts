import { env } from "@/env";
import { getAuthIssuer } from "@/lib/auth/issuer";
import {
  IDENTITY_SCOPES,
  PROOF_SCOPES,
} from "@/lib/auth/oidc/disclosure-registry";

/**
 * RFC 9728 — OAuth 2.0 Protected Resource Metadata
 *
 * Advertises Zentity as a protected resource and points MCP clients
 * to the authorization server. Since Zentity serves as both AS and RS,
 * the authorization_servers array contains the auth issuer URL derived
 * from the same origin.
 */
export function GET() {
  const resource = env.NEXT_PUBLIC_APP_URL;
  const authIssuer = getAuthIssuer();

  const metadata = {
    resource,
    authorization_servers: [authIssuer],
    scopes_supported: [
      "openid",
      "email",
      "offline_access",
      "proof:identity",
      ...PROOF_SCOPES,
      "compliance:key:read",
      "compliance:key:write",
      ...IDENTITY_SCOPES,
      "identity_verification",
      "poh",
    ],
    bearer_methods_supported: ["header", "dpop"],
    resource_signing_alg_values_supported: ["EdDSA"],
  };

  return new Response(JSON.stringify(metadata), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
