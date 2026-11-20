import "server-only";

/**
 * OAuth Request: signed query verification, request key derivation, and
 * resource URI validation (RFC 8707).
 *
 * Everything server-side that parses or validates an inbound OAuth/OIDC
 * request payload. Client-side post-auth redirect continuation lives in
 * `oauth-post-login.ts`.
 */

/**
 * OAuth Request: signed query verification, request key derivation, and
 * resource URI validation (RFC 8707).
 *
 * Everything server-side that parses or validates an inbound OAuth/OIDC
 * request payload. Client-side post-auth redirect continuation lives in
 * `oauth-post-login.ts`.
 */

import { createHmac } from "node:crypto";

import { verifyOAuthQueryParams } from "@better-auth/oauth-provider";
import { calculateJwkThumbprint } from "jose";

import { env } from "@/env";
import { isIdentityScope } from "@/lib/auth/oidc/disclosure/registry";

// ---------------------------------------------------------------------------
// Signed OAuth query verification
// ---------------------------------------------------------------------------

export async function verifySignedOAuthQuery(
  query: string
): Promise<URLSearchParams> {
  if (!(await verifyOAuthQueryParams(query, env.BETTER_AUTH_SECRET))) {
    throw new Error("invalid_signature");
  }

  const params = new URLSearchParams(query);
  params.delete("sig");
  params.delete("exp");
  return params;
}

// ---------------------------------------------------------------------------
// Authorization request parameters
// ---------------------------------------------------------------------------

interface AuthorizeHookContext {
  /** Set by the provider when it re-runs authorize inside another request. */
  authorizeSettings?: { isAuthorize?: boolean };
  body?: unknown;
  method?: string;
  query?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The parameters of an `/oauth2/authorize` request, read where the provider
 * reads them (`getAuthorizationRequestParameters`): the form body of a direct
 * POST, otherwise the query. The provider also re-runs authorize after
 * sign-in, consent, and continue, and those runs carry the request in the
 * query even inside a POST.
 *
 * The returned record is the request's own object, so changes to it reach the
 * provider.
 */
export function authorizeRequestParameters(
  ctx: AuthorizeHookContext
): Record<string, unknown> {
  const isDirect =
    ctx.authorizeSettings === undefined ||
    ctx.authorizeSettings.isAuthorize === true;
  const source = ctx.method === "POST" && isDirect ? ctx.body : ctx.query;
  return isRecord(source) ? source : {};
}

export function parseRequestedScopes(queryParams: URLSearchParams): string[] {
  return (queryParams.get("scope") ?? "")
    .split(" ")
    .map((scope) => scope.trim())
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Canonical OAuth request key (stable hash for idempotency + correlation)
// ---------------------------------------------------------------------------

// The signature envelope and Better Auth's signed-query bookkeeping change as
// the same authorization request moves between the consent page and the API.
const OAUTH_QUERY_ENVELOPE_FIELDS = new Set([
  "sig",
  "exp",
  "ba_iat",
  "ba_param",
  "ba_pl",
]);

type CanonicalQueryValue =
  | null
  | string
  | number
  | boolean
  | CanonicalQueryValue[]
  | { [key: string]: CanonicalQueryValue };

function normalizeCanonicalValue(value: unknown): CanonicalQueryValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => normalizeCanonicalValue(entry));
  }

  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, normalizeCanonicalValue(entry)])
    );
  }

  return String(value);
}

function canonicalizeQueryRecord(
  query: Record<string, unknown>
): Record<string, CanonicalQueryValue> {
  return Object.fromEntries(
    Object.entries(query)
      .filter(
        ([key, value]) =>
          !OAUTH_QUERY_ENVELOPE_FIELDS.has(key) && value !== undefined
      )
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => [key, normalizeCanonicalValue(value)])
  );
}

function canonicalizeOAuthQuery(
  query: URLSearchParams | Record<string, unknown>
): string {
  if (query instanceof URLSearchParams) {
    const record: Record<string, string | string[]> = {};
    const keys = [...new Set(query.keys())].sort((a, b) => a.localeCompare(b));
    for (const key of keys) {
      if (OAUTH_QUERY_ENVELOPE_FIELDS.has(key)) {
        continue;
      }
      const values = query.getAll(key);
      if (values.length === 1) {
        record[key] = values[0] ?? "";
      } else if (values.length > 1) {
        record[key] = values;
      }
    }
    return JSON.stringify(record);
  }

  return JSON.stringify(canonicalizeQueryRecord(query));
}

export function computeOAuthRequestKey(
  query: URLSearchParams | Record<string, unknown>
): string {
  return createHmac("sha256", env.BETTER_AUTH_SECRET)
    .update(canonicalizeOAuthQuery(query))
    .digest("hex");
}

/**
 * Correlate staged identity claims with the provider's consent query, which
 * omits identity scopes. Preserve this normalization for in-flight stages.
 */
export function computeOAuthDisclosureRequestKey(
  query: URLSearchParams
): string {
  const normalized = new URLSearchParams(query);
  const scopes = normalized.get("scope");
  if (scopes) {
    normalized.set(
      "scope",
      [
        ...new Set(
          scopes.split(" ").filter((scope) => !isIdentityScope(scope))
        ),
      ].join(" ")
    );
  }
  return computeOAuthRequestKey(normalized);
}

// ---------------------------------------------------------------------------
// RFC 8707 — Resource Indicators for OAuth 2.0
// ---------------------------------------------------------------------------

interface ResourceValidationResult {
  error?: string;
  valid: boolean;
}

export function validateResourceUri(
  resource: unknown
): ResourceValidationResult {
  if (typeof resource !== "string" || resource.length === 0) {
    return { valid: false, error: "resource parameter is required" };
  }

  let url: URL;
  try {
    url = new URL(resource);
  } catch {
    return { valid: false, error: "resource must be an absolute URI" };
  }

  if (url.hash) {
    return {
      valid: false,
      error: "resource must not contain a fragment component",
    };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { valid: false, error: "resource must use http or https scheme" };
  }

  return { valid: true };
}

export function computeJwkThumbprint(rawJwk: string): Promise<string> {
  const jwk = JSON.parse(rawJwk) as Record<string, unknown>;
  return calculateJwkThumbprint(jwk);
}
