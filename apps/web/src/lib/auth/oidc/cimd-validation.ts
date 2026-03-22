// Pure validation functions for CIMD (Client ID Metadata Document).
// Implements draft-ietf-oauth-client-id-metadata-document-01 §3 and §4.1.
// No side-effectful imports — safe for unit testing.

import { isPrivateHost as _isPrivateHost } from "@/lib/auth/url-safety";

const isPrivateHost = _isPrivateHost;

/**
 * Detect URL-formatted client_id (MCP CIMD pattern).
 * HTTPS always allowed; http://localhost allowed when not in production.
 */
export function isUrlClientId(
  clientId: string,
  isProduction: boolean
): boolean {
  if (clientId.startsWith("https://")) {
    return true;
  }
  if (!isProduction && clientId.startsWith("http://localhost")) {
    return true;
  }
  return false;
}

export interface CimdMetadata {
  client_id: string;
  client_name: string;
  client_uri?: string | undefined;
  grant_types?: string[] | undefined;
  logo_uri?: string | undefined;
  redirect_uris: string[];
  response_types?: string[] | undefined;
  scope?: string | undefined;
  token_endpoint_auth_method?: string | undefined;
}

export interface CimdValidationResult {
  error?: string;
  metadata?: CimdMetadata;
  valid: boolean;
  warnings?: string[];
}

const ALLOWED_GRANT_TYPES = new Set([
  "authorization_code",
  "refresh_token",
  "urn:openid:params:grant-type:ciba",
]);
const ALLOWED_RESPONSE_TYPES = new Set(["code"]);
const DOT_SEGMENT_RE = /\/\.\.?(?:\/|$|#|\?)/;

const PROHIBITED_FIELDS = new Set([
  "client_secret",
  "client_secret_expires_at",
]);
const SYMMETRIC_AUTH_METHODS = new Set([
  "client_secret_post",
  "client_secret_basic",
  "client_secret_jwt",
]);

function isAbsoluteHttpUri(uri: string): boolean {
  try {
    const parsed = new URL(uri);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function validateCimdMetadata(
  url: string,
  raw: unknown,
  isProduction = true
): CimdValidationResult {
  if (!raw || typeof raw !== "object") {
    return { valid: false, error: "metadata document is not a JSON object" };
  }

  const doc = raw as Record<string, unknown>;
  const warnings: string[] = [];

  if (doc.client_id !== url) {
    return {
      valid: false,
      error: `client_id "${String(doc.client_id)}" does not match fetch URL`,
    };
  }

  if (typeof doc.client_name !== "string" || doc.client_name.length === 0) {
    return { valid: false, error: "client_name is required" };
  }

  // §4.1: prohibited fields
  for (const field of PROHIBITED_FIELDS) {
    if (field in doc) {
      return {
        valid: false,
        error: `metadata document MUST NOT contain "${field}"`,
      };
    }
  }

  // §4.1: symmetric auth methods prohibited
  if (
    typeof doc.token_endpoint_auth_method === "string" &&
    SYMMETRIC_AUTH_METHODS.has(doc.token_endpoint_auth_method)
  ) {
    return {
      valid: false,
      error: `symmetric auth method "${doc.token_endpoint_auth_method}" is prohibited for CIMD clients`,
    };
  }

  if (
    doc.token_endpoint_auth_method !== undefined &&
    doc.token_endpoint_auth_method !== "none"
  ) {
    return {
      valid: false,
      error: 'token_endpoint_auth_method must be "none" for CIMD clients',
    };
  }

  if (
    !Array.isArray(doc.redirect_uris) ||
    doc.redirect_uris.length === 0 ||
    !doc.redirect_uris.every(
      (uri: unknown) => typeof uri === "string" && isAbsoluteHttpUri(uri)
    )
  ) {
    return {
      valid: false,
      error: "redirect_uris must be a non-empty array of absolute URIs",
    };
  }

  if (
    doc.grant_types !== undefined &&
    !(
      Array.isArray(doc.grant_types) &&
      doc.grant_types.every(
        (g: unknown) => typeof g === "string" && ALLOWED_GRANT_TYPES.has(g)
      )
    )
  ) {
    return {
      valid: false,
      error:
        'grant_types must be a subset of ["authorization_code", "refresh_token", "urn:openid:params:grant-type:ciba"]',
    };
  }

  if (
    doc.response_types !== undefined &&
    !(
      Array.isArray(doc.response_types) &&
      doc.response_types.every(
        (r: unknown) => typeof r === "string" && ALLOWED_RESPONSE_TYPES.has(r)
      )
    )
  ) {
    return {
      valid: false,
      error: 'response_types must be a subset of ["code"]',
    };
  }

  // Parse optional client_uri with SSRF validation
  let clientUri: string | undefined;
  if (typeof doc.client_uri === "string") {
    const err = validateFetchUrl(doc.client_uri, isProduction);
    if (err) {
      return { valid: false, error: `client_uri: ${err}` };
    }
    clientUri = doc.client_uri;
  }

  // Parse optional logo_uri with SSRF validation
  let logoUri: string | undefined;
  if (typeof doc.logo_uri === "string") {
    const err = validateFetchUrl(doc.logo_uri, isProduction);
    if (err) {
      return { valid: false, error: `logo_uri: ${err}` };
    }
    logoUri = doc.logo_uri;
  }

  // Parse optional scope (informational)
  const scope = typeof doc.scope === "string" ? doc.scope : undefined;

  return {
    valid: true,
    metadata: {
      client_id: doc.client_id as string,
      client_name: doc.client_name as string,
      redirect_uris: doc.redirect_uris as string[],
      grant_types: doc.grant_types as string[] | undefined,
      response_types: doc.response_types as string[] | undefined,
      token_endpoint_auth_method: doc.token_endpoint_auth_method as
        | string
        | undefined,
      client_uri: clientUri,
      logo_uri: logoUri,
      scope,
    },
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

/**
 * Validate a URL before fetching it as a metadata document.
 * Implements IETF draft §3 URL validation rules.
 * Returns null on success, error string on failure.
 */
/**
 * Validate a URL for SSRF safety.
 * When `requirePath` is true (default), also enforces §3 client_id URL rules
 * (no fragments, dot segments, credentials; must have a path).
 */
export function validateFetchUrl(
  url: string,
  isProduction: boolean,
  requirePath = false
): string | null {
  if (requirePath) {
    // §3: check raw URL for dot segments before URL class normalizes them
    if (DOT_SEGMENT_RE.test(url)) {
      return "client_id URL MUST NOT contain dot segments";
    }

    // §3: MUST NOT contain fragments (check raw string — URL class preserves)
    if (url.includes("#")) {
      return "client_id URL MUST NOT contain a fragment";
    }
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "client_id is not a valid URL";
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return "client_id URL must use HTTPS";
  }

  if (parsed.protocol === "http:" && isProduction) {
    return "client_id URL must use HTTPS in production";
  }

  // §3: MUST NOT contain credentials
  if (parsed.username || parsed.password) {
    return "client_id URL MUST NOT contain credentials";
  }

  // §3: MUST contain a path (not just scheme + authority)
  if (requirePath && (parsed.pathname === "/" || parsed.pathname === "")) {
    return "client_id URL MUST contain a path";
  }

  if (!isProduction && parsed.hostname === "localhost") {
    return null;
  }

  if (isPrivateHost(parsed.hostname)) {
    return "client_id URL must not resolve to a private address";
  }

  return null;
}

/**
 * Check if a URL has a query string (§3 SHOULD NOT).
 * Returns a warning string if present, null otherwise.
 */
export function checkUrlQueryWarning(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.search) {
      return "client_id URL SHOULD NOT contain a query string";
    }
  } catch {
    // Already handled by validateFetchUrl
  }
  return null;
}
