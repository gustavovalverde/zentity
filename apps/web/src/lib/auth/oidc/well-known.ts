/**
 * Discovery for the OAuth provider and shared utilities for the .well-known
 * route handlers, which serve:
 * - /.well-known/openid-configuration
 * - /.well-known/oauth-authorization-server
 * - /.well-known/openid-credential-issuer
 */

import type { OAuthProviderExtension } from "@better-auth/oauth-provider";

import { env } from "@/env";

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

/**
 * Discovery fields Zentity adds to the provider's openid-configuration and
 * oauth-authorization-server documents. The provider merges extension fields
 * first-wins and never lets one replace its own. This extension is registered
 * ahead of every plugin's, so its `authorization_details_types_supported`
 * replaces HAIP's and must list every type the authorization server accepts.
 */
export const discoveryMetadataExtension: OAuthProviderExtension = {
  metadata: ({ document }) => ({
    authorization_challenge_endpoint: `${document.issuer}/oauth2/authorize-challenge`,
    // openid_credential (OID4VCI, via HAIP) and payment_authorization
    // (RFC 9396 payment approvals).
    authorization_details_types_supported: [
      "openid_credential",
      "payment_authorization",
    ],
    // MCP authorization (RFC 8707 resource indicators)
    resource_indicators_supported: true,
    // Proof-of-Human (PRD-22)
    poh_endpoint: `${document.issuer}/oauth2/proof-of-human`,
    validity_endpoint: `${document.issuer}/oauth2/validity`,
    poh_issuer_uri: `${document.issuer}/.well-known/proof-of-human`,
  }),
};

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
