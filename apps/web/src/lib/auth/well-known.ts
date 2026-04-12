/**
 * Shared utilities for OIDC .well-known route handlers.
 *
 * These routes serve metadata at standard discovery endpoints:
 * - /.well-known/openid-configuration
 * - /.well-known/oauth-authorization-server
 * - /.well-known/openid-credential-issuer
 *
 * HAIP and CIBA metadata (PAR, DPoP, backchannel auth) are now contributed
 * by their respective plugins via the Plugin Extension Protocol.
 * This function only adds Zentity-specific fields not covered by extensions.
 */

import { env } from "@/env";
import { ACR_VALUES_SUPPORTED } from "@/lib/assurance/oidc-claims";

const TRAILING_SLASHES_REGEX = /\/+$/;
const LEADING_SLASHES_REGEX = /^\/+/;

export const DEFAULT_AUTH_BASE_PATH = "/api/auth";

// ── Issuer URL utilities ─────────────────────────────────

export const getAuthIssuer = (): string => {
  const base = env.NEXT_PUBLIC_APP_URL;
  try {
    const url = new URL(base);
    if (!url.pathname || url.pathname === "/") {
      url.pathname = "/api/auth";
    }
    url.pathname = url.pathname.replace(TRAILING_SLASHES_REGEX, "");
    return url.toString();
  } catch {
    return "http://localhost:3000/api/auth";
  }
};

export const joinAuthIssuerPath = (issuer: string, path: string): string => {
  const normalized = issuer.endsWith("/") ? issuer : `${issuer}/`;
  return new URL(
    path.replace(LEADING_SLASHES_REGEX, ""),
    normalized
  ).toString();
};

/** Algorithms advertised in id_token_signing_alg_values_supported. */
const ID_TOKEN_SIGNING_ALGS = ["RS256", "ES256", "EdDSA", "ML-DSA-65"] as const;

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
    // Zentity-specific endpoint metadata not covered by plugin extensions
    ...(issuer
      ? {
          jwks_uri: `${issuer}/oauth2/jwks`,
          authorization_challenge_endpoint: new URL(
            "/api/oauth2/authorize-challenge",
            issuer
          ).toString(),
        }
      : {}),
    // OIDC Back-Channel Logout 1.0 (not in upstream plugins)
    backchannel_logout_supported: true,
    backchannel_logout_session_supported: true,
    ...(issuer ? { end_session_endpoint: `${issuer}/oauth2/end-session` } : {}),
    // Assurance metadata
    acr_values_supported: [...ACR_VALUES_SUPPORTED],
    claims_parameter_supported: true,
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
    // Proof-of-Human (PRD-22)
    ...(issuer
      ? {
          poh_endpoint: `${issuer}/api/auth/oauth2/proof-of-human`,
          poh_issuer_uri: `${issuer}/.well-known/proof-of-human`,
        }
      : {}),
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

/**
 * Call auth.api methods that exist at runtime but aren't in the InferAPI type.
 * The oauth-provider plugin registers these endpoints but TypeScript can't infer
 * them through the betterAuth() generic chain.
 */
export function callAuthApi(
  api: Record<string, unknown>,
  method: string,
  ...args: unknown[]
): unknown {
  const fn = api[method];
  if (typeof fn !== "function") {
    throw new Error(`auth.api.${method} is not available`);
  }
  return fn(...args);
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
