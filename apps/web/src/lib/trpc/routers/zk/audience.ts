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
