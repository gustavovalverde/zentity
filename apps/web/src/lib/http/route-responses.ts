import "server-only";

import { encode } from "@msgpack/msgpack";

import { logError } from "@/lib/logging/error-logger";
import { resolveRequestContext } from "@/lib/observability/request-context";

/**
 * Log an error with request tracking and return a short reference ID.
 *
 * Use this in non-tRPC API route handlers to:
 * 1. Log the full error details server-side (with requestId for correlation)
 * 2. Return a short reference that users can report for debugging
 *
 * The tRPC layer has its own errorFormatter that handles this automatically.
 * This utility covers the REST API routes that bypass tRPC.
 *
 * @returns 8-char reference ID (prefix of the full requestId logged server-side)
 */
export function sanitizeAndLogApiError(
  error: unknown,
  req: Request,
  context?: { operation?: string }
): string {
  const { requestId } = resolveRequestContext(req.headers);
  logError(error, { requestId, ...context });
  return requestId.slice(0, 8);
}

export function msgpackResponse(data: unknown, status = 200): Response {
  return new Response(encode(data), {
    status,
    headers: { "Content-Type": "application/msgpack" },
  });
}

export function jsonError(message: string, status = 400): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
