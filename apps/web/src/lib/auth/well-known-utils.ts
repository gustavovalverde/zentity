/**
 * Shared utilities for OIDC .well-known route handlers.
 *
 * These routes serve metadata at standard discovery endpoints:
 * - /.well-known/openid-configuration
 * - /.well-known/oauth-authorization-server
 * - /.well-known/openid-credential-issuer
 */

const TRAILING_SLASHES_REGEX = /\/+$/;
const LEADING_SLASHES_REGEX = /^\/+/;

export const DEFAULT_AUTH_BASE_PATH = "/api/auth";

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
