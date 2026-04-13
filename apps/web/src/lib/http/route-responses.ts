import "server-only";

import { encode } from "@msgpack/msgpack";

import { logError } from "@/lib/logging/error-logger";
import { resolveRequestContext } from "@/lib/observability/request-context";

import { HttpError } from "./fetch";

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

function getErrorStringFromBodyText(bodyText: string): string | undefined {
  if (!bodyText) {
    return;
  }

  try {
    const parsed = JSON.parse(bodyText) as unknown;
    if (typeof parsed === "string") {
      return parsed;
    }
    if (!parsed || typeof parsed !== "object") {
      return;
    }

    const maybeError = (parsed as { error?: unknown }).error;
    if (typeof maybeError === "string" && maybeError.trim()) {
      return maybeError;
    }

    const maybeMessage = (parsed as { message?: unknown }).message;
    if (typeof maybeMessage === "string" && maybeMessage.trim()) {
      return maybeMessage;
    }
  } catch {
    // ignore
  }
  return undefined;
}

/**
 * Transform an arbitrary error into a safe HTTP response payload for
 * proxy-style routes that forward upstream service errors. HttpError is
 * unwrapped to surface the upstream error message; other errors get a
 * generic 503 with the fallback message.
 */
export function toServiceErrorPayload(
  error: unknown,
  fallbackMessage: string
): { status: number; payload: { error: string } } {
  if (error instanceof HttpError) {
    const message =
      getErrorStringFromBodyText(error.bodyText) ?? fallbackMessage;
    return { status: error.status, payload: { error: message } };
  }

  if (error instanceof Error) {
    return { status: 503, payload: { error: fallbackMessage } };
  }

  return { status: 503, payload: { error: fallbackMessage } };
}
