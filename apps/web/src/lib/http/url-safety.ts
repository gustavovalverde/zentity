/**
 * URL and Request origin safety.
 *
 * Outbound: SSRF protection — private-host detection and safe-URL validation
 * (used by DCR, CIMD, and any fetch-from-user-input path).
 *
 * Inbound: Request origin resolution — canonical relying-party origin for
 * proof/challenge audience binding.
 */

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

interface SafeUrlOptions {
  /** Allow http://localhost in non-production (default: true). */
  allowLocalhostInDev?: boolean;
  /** Require HTTPS (default: true). */
  requireHttps?: boolean;
}

/**
 * Validate a URL is safe to fetch: parses URL, enforces HTTPS in prod,
 * blocks private/internal IPs, allows localhost in dev.
 * Returns null on success, error string on failure.
 */
export function validateSafeUrl(
  url: string,
  isProduction: boolean,
  options?: SafeUrlOptions
): string | null {
  const requireHttps = options?.requireHttps ?? true;
  const allowLocalhostInDev = options?.allowLocalhostInDev ?? true;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "URL is not valid";
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return "URL must use HTTPS";
  }

  if (requireHttps && parsed.protocol === "http:" && isProduction) {
    return "URL must use HTTPS in production";
  }

  if (allowLocalhostInDev && !isProduction && parsed.hostname === "localhost") {
    return null;
  }

  if (parsed.hostname === "localhost" || isPrivateHost(parsed.hostname)) {
    return "URL must not resolve to a private address";
  }

  return null;
}

const TRAILING_COLON_REGEX = /:$/;

/**
 * Resolve the relying-party audience origin for proof/challenge context binding.
 *
 * Priority:
 * 1) `Origin` request header (best match for browser context)
 * 2) Forwarded host/proto headers (proxy-aware)
 * 3) Request URL origin
 * 4) `"unknown"` fallback
 */
export function resolveAudience(req: Request): string {
  const originHeader = req.headers.get("origin");
  if (originHeader) {
    try {
      return new URL(originHeader).origin;
    } catch {
      // Fall through to alternate sources
    }
  }

  let requestUrl: URL | null = null;
  try {
    requestUrl = new URL(req.url);
  } catch {
    requestUrl = null;
  }

  const forwardedHost =
    req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (forwardedHost) {
    const forwardedProto = req.headers
      .get("x-forwarded-proto")
      ?.split(",")[0]
      ?.trim();
    const protocol =
      forwardedProto ||
      (requestUrl
        ? requestUrl.protocol.replace(TRAILING_COLON_REGEX, "")
        : "https");

    try {
      return new URL(`${protocol}://${forwardedHost}`).origin;
    } catch {
      // Fall through to request URL
    }
  }

  if (requestUrl) {
    return requestUrl.origin;
  }

  return "unknown";
}
