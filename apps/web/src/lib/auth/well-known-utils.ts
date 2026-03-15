/**
 * Shared utilities for OIDC .well-known route handlers.
 *
 * These routes serve metadata at standard discovery endpoints:
 * - /.well-known/openid-configuration
 * - /.well-known/oauth-authorization-server
 * - /.well-known/openid-credential-issuer
 *
 * HAIP metadata (PAR, DPoP) is added here rather than relying on
 * plugin after-hooks, because Next.js route handlers call
 * auth.api.getOpenIdConfig() directly — bypassing the HTTP hook chain.
 */

import { ACR_VALUES_SUPPORTED } from "@/lib/assurance/oidc-claims";

const TRAILING_SLASHES_REGEX = /\/+$/;
const LEADING_SLASHES_REGEX = /^\/+/;

export const DEFAULT_AUTH_BASE_PATH = "/api/auth";

/** Algorithms advertised in id_token_signing_alg_values_supported. */
export const ID_TOKEN_SIGNING_ALGS = [
  "RS256",
  "ES256",
  "EdDSA",
  "ML-DSA-65",
] as const;

/**
 * Enrich raw discovery metadata with signing algorithms and HAIP fields.
 * Used by both openid-configuration and oauth-authorization-server route handlers.
 */
export function enrichDiscoveryMetadata(
  metadata: Record<string, unknown>
): Record<string, unknown> {
  const issuer = metadata.issuer as string | undefined;
  return {
    ...metadata,
    subject_types_supported: ["public", "pairwise"],
    id_token_signing_alg_values_supported: [...ID_TOKEN_SIGNING_ALGS],
    // HAIP §5.1: PAR and DPoP metadata
    ...(issuer
      ? {
          jwks_uri: `${issuer}/oauth2/jwks`,
          pushed_authorization_request_endpoint: `${issuer}/oauth2/par`,
          backchannel_authentication_endpoint: `${issuer}/oauth2/bc-authorize`,
          authorization_challenge_endpoint: new URL(
            "/api/oauth2/authorize-challenge",
            issuer
          ).toString(),
        }
      : {}),
    require_pushed_authorization_requests: true,
    dpop_signing_alg_values_supported: ["ES256"],
    authorization_details_types_supported: ["openid_credential"],
    // CIBA metadata (OpenID CIBA Core §4)
    backchannel_token_delivery_modes_supported: ["poll", "ping"],
    backchannel_user_code_parameter_supported: false,
    // OIDC Back-Channel Logout 1.0
    backchannel_logout_supported: true,
    backchannel_logout_session_supported: true,
    ...(issuer ? { end_session_endpoint: `${issuer}/oauth2/end-session` } : {}),
    // Assurance metadata
    acr_values_supported: [...ACR_VALUES_SUPPORTED],
    claims_supported: [
      ...((metadata.claims_supported as string[]) ?? []),
      "acr",
      "amr",
      "auth_time",
      "acr_eidas",
      "at_hash",
    ],
    // MCP authorization compatibility (RFC 9728, CIMD)
    client_id_metadata_document_supported: true,
    resource_indicators_supported: true,
  };
}

function normalizePath(value: string): string {
  return value
    .replace(TRAILING_SLASHES_REGEX, "")
    .replace(LEADING_SLASHES_REGEX, "");
}

export function issuerPathMatches(
  requestedPath: string | undefined,
  expectedPath: string | undefined
): boolean {
  const expected = normalizePath(expectedPath ?? "");
  const actual = normalizePath(requestedPath ?? "");
  if (!(expected || actual)) {
    return true;
  }
  if (!actual) {
    return true;
  }
  return expected === actual;
}

export function unwrapMetadata(value: unknown): unknown {
  if (value instanceof Response) {
    return value;
  }
  if (value && typeof value === "object" && "response" in value) {
    return (value as { response: unknown }).response;
  }
  return value;
}

export function buildWellKnownResponse(metadata: unknown): Response {
  if (metadata instanceof Response) {
    return metadata;
  }
  return new Response(JSON.stringify(metadata ?? {}), {
    status: 200,
    headers: {
      "Cache-Control":
        "public, max-age=15, stale-while-revalidate=15, stale-if-error=86400",
      "Content-Type": "application/json",
    },
  });
}
