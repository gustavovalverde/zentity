/**
 * URL and Request origin safety.
 *
 * Outbound: SSRF protection for URLs the server sends requests to
 * (client-registered delivery endpoints, software statement issuers).
 *
 * Inbound: Request origin resolution — canonical relying-party origin for
 * proof/challenge audience binding.
 */

import { classifyHost, isLoopbackHost } from "@better-auth/core/utils/host";

const INTERNAL_DNS_SUFFIXES = [".internal", ".local", ".home.arpa", ".lan"];
const TRAILING_DOTS_REGEX = /\.+$/;

function loopbackTargetsAllowed(): boolean {
  return process.env.NODE_ENV !== "production";
}

function isInternalHostname(hostname: string): boolean {
  const name = hostname.replace(TRAILING_DOTS_REGEX, "").toLowerCase();
  return (
    !name.includes(".") ||
    INTERNAL_DNS_SUFFIXES.some((suffix) => name.endsWith(suffix))
  );
}

/**
 * True only for publicly routable IP addresses. Every RFC 6890
 * special-purpose range is rejected, including IPv4-mapped and tunnelled
 * IPv6 forms that embed a non-public IPv4 address.
 */
function isPublicAddress(address: string): boolean {
  const { kind, literal } = classifyHost(address);
  return literal !== "fqdn" && kind === "public";
}

/**
 * Validate a client-registered URL the server will send requests to.
 * Requires HTTPS to a public DNS name or public IP literal. Outside
 * production, loopback hosts are also accepted over HTTP or HTTPS.
 * Returns null on success, error string on failure.
 */
export function validateOutboundUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "is not a valid URL";
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return "must use HTTPS";
  }
  if (parsed.username || parsed.password) {
    return "must not contain credentials";
  }
  if (loopbackTargetsAllowed() && isLoopbackHost(parsed.hostname)) {
    return null;
  }
  if (parsed.protocol !== "https:") {
    return "must use HTTPS";
  }

  const { kind, literal } = classifyHost(parsed.hostname);
  if (literal !== "fqdn") {
    return kind === "public"
      ? null
      : "must not point to a private or reserved address";
  }
  if (kind !== "public" || isInternalHostname(parsed.hostname)) {
    return "must not point to an internal host";
  }
  return null;
}

/**
 * Whether a resolved address may be connected to for an already validated
 * URL. Loopback hostnames (outside production) may reach only loopback
 * addresses; every other hostname may reach only public addresses.
 */
export function isPermittedDestination(url: URL, address: string): boolean {
  if (loopbackTargetsAllowed() && isLoopbackHost(url.hostname)) {
    return classifyHost(address).kind === "loopback";
  }
  return isPublicAddress(address);
}

const SAFE_PATH_SEGMENT_REGEX = /^[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*$/;

/**
 * Validate path segments forwarded to an upstream service.
 *
 * The regex requires every segment to start with an alphanumeric/underscore/dash
 * and carry only dotted suffixes after that, which rejects empty segments,
 * traversal (`.`, `..`), leading dots (hidden files), separators, and anything
 * outside `[A-Za-z0-9_.-]`. Returns `true` only when every segment passes.
 */
export function isSafePathSegments(
  segments: readonly (string | undefined)[]
): boolean {
  if (segments.length === 0) {
    return false;
  }
  return segments.every(
    (segment) =>
      typeof segment === "string" && SAFE_PATH_SEGMENT_REGEX.test(segment)
  );
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
