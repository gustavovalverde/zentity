/**
 * Shared SSRF protection — single source of truth for private-host detection
 * and safe-URL validation across DCR, CIMD, and any future fetch-from-user-input.
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
