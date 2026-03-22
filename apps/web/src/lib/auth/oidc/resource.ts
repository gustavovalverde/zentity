/**
 * RFC 8707 — Resource Indicators for OAuth 2.0
 *
 * Validates the `resource` parameter: must be an absolute URI
 * without a fragment component (RFC 8707 §2).
 */

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
