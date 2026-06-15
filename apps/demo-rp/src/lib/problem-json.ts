import "server-only";

/**
 * RFC 7807 `application/problem+json` envelope shared across the zpay channel
 * (PRD-43 D-H: one error vocabulary end to end). The wallet and the facilitator
 * both speak `kind`/`title`/`detail`/`retryable` plus an optional `remediation`
 * object and `Retry-After`; the BFF passes those through verbatim so an
 * autonomous agent reads ONE error language, reserving BFF-invented tags for
 * BFF-only failures.
 */

export interface ServiceProblem {
  detail?: string;
  kind: string;
  remediation?: Record<string, unknown>;
  retryAfterSeconds?: number;
  retryable?: boolean;
  title: string;
}

function parseRetryAfter(headerValue: string | null): number | undefined {
  if (!headerValue) {
    return undefined;
  }
  const seconds = Number(headerValue);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds;
  }
  // RFC 7231 also allows an HTTP-date; translate to a delta in seconds.
  const when = Date.parse(headerValue);
  if (Number.isNaN(when)) {
    return undefined;
  }
  return Math.max(0, Math.round((when - Date.now()) / 1000));
}

/**
 * Parse an already-read body as `problem+json` when the headers advertise it.
 * Returns null for any non-problem or unparseable body. Takes the body string
 * so a caller that must also fall back to the raw text reads the stream once
 * (a Response body can only be consumed once).
 */
export function parseProblemFromBody(
  headers: Headers,
  raw: string,
  fallbackTitle: string
): ServiceProblem | null {
  const contentType = headers.get("content-type") ?? "";
  if (!contentType.includes("application/problem+json") || !raw) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!(parsed && typeof parsed === "object")) {
    return null;
  }
  const body = parsed as Record<string, unknown>;
  const problem: ServiceProblem = {
    kind: typeof body.kind === "string" ? body.kind : "unknown",
    title: typeof body.title === "string" ? body.title : fallbackTitle,
  };
  if (typeof body.detail === "string") {
    problem.detail = body.detail;
  }
  if (typeof body.retryable === "boolean") {
    problem.retryable = body.retryable;
  }
  if (body.remediation && typeof body.remediation === "object") {
    problem.remediation = body.remediation as Record<string, unknown>;
  }
  const retryAfter = parseRetryAfter(headers.get("retry-after"));
  if (retryAfter !== undefined) {
    problem.retryAfterSeconds = retryAfter;
  }
  return problem;
}

/**
 * Parse a `problem+json` response when it advertises one. Returns null for any
 * non-problem response so callers fall back to raw text. Consumes the body.
 */
export async function parseProblem(
  response: Response,
  fallbackTitle: string
): Promise<ServiceProblem | null> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/problem+json")) {
    return null;
  }
  const raw = await response.text().catch(() => "");
  return parseProblemFromBody(response.headers, raw, fallbackTitle);
}
