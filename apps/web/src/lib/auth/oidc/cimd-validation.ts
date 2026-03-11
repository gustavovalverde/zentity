// Pure validation functions for CIMD (Client ID Metadata Document).
// No side-effectful imports — safe for unit testing.

const PRIVATE_RANGES = [
  /^127\./, // loopback
  /^10\./, // Class A
  /^172\.(1[6-9]|2\d|3[01])\./, // Class B
  /^192\.168\./, // Class C
  /^0\./, // "this" network
  /^169\.254\./, // link-local
  /^\[?::1\]?$/, // IPv6 loopback
  /^\[?fe80:/i, // IPv6 link-local
  /^\[?fc00:/i, // IPv6 ULA
  /^\[?fd/i, // IPv6 ULA
];

export function isPrivateHost(hostname: string): boolean {
  return PRIVATE_RANGES.some((re) => re.test(hostname));
}

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
  grant_types?: string[];
  redirect_uris: string[];
  response_types?: string[];
  token_endpoint_auth_method?: string;
}

export interface CimdValidationResult {
  error?: string;
  metadata?: CimdMetadata;
  valid: boolean;
}

const ALLOWED_GRANT_TYPES = new Set(["authorization_code"]);
const ALLOWED_RESPONSE_TYPES = new Set(["code"]);

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
  raw: unknown
): CimdValidationResult {
  if (!raw || typeof raw !== "object") {
    return { valid: false, error: "metadata document is not a JSON object" };
  }

  const doc = raw as Record<string, unknown>;

  if (doc.client_id !== url) {
    return {
      valid: false,
      error: `client_id "${String(doc.client_id)}" does not match fetch URL`,
    };
  }

  if (typeof doc.client_name !== "string" || doc.client_name.length === 0) {
    return { valid: false, error: "client_name is required" };
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
      error: 'grant_types must be a subset of ["authorization_code"]',
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

  if (
    doc.token_endpoint_auth_method !== undefined &&
    doc.token_endpoint_auth_method !== "none"
  ) {
    return {
      valid: false,
      error: 'token_endpoint_auth_method must be "none" for CIMD clients',
    };
  }

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
    },
  };
}

/**
 * Validate a URL before fetching it as a metadata document.
 * Returns null on success, error string on failure.
 */
export function validateFetchUrl(
  url: string,
  isProduction: boolean
): string | null {
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

  if (!isProduction && parsed.hostname === "localhost") {
    return null;
  }

  if (isPrivateHost(parsed.hostname)) {
    return "client_id URL must not resolve to a private address";
  }

  return null;
}
