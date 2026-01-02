/**
 * Error Logger with Fingerprinting
 *
 * Provides structured error logging with:
 * - Error fingerprinting for grouping similar errors
 * - Context extraction from known error types (FheServiceError, HttpError, TRPCError)
 * - Consistent log format across the application
 */
import "server-only";

import { createHash } from "node:crypto";

import { TRPCError } from "@trpc/server";

import { FheServiceError } from "@/lib/crypto/fhe-client";
import { HttpError } from "@/lib/utils/http";

import { type Logger, logger } from "./logger";
import { sanitizeLogMessage } from "./redact";

/** Matches stack trace location: "at functionName (file:line:col)" or "at file:line:col" */
const STACK_LOCATION_PATTERN = /at\s+(?:(.+?)\s+\()?(.+?):(\d+):\d+\)?/;

/** Matches path prefix up to and including /src/ for normalization */
const SRC_PATH_PREFIX_PATTERN = /^.*?\/src\//;

interface ErrorContext {
  requestId?: string;
  path?: string;
  userId?: string;
  operation?: string;
  duration?: number;
}

/**
 * Extracts structured context from known error types.
 * This provides richer log data for debugging without exposing sensitive info.
 */
function extractErrorContext(error: unknown): Record<string, unknown> {
  if (error instanceof FheServiceError) {
    return {
      errorType: "FheServiceError",
      operation: error.operation,
      kind: error.kind,
      status: error.status,
    };
  }
  if (error instanceof HttpError) {
    return {
      errorType: "HttpError",
      status: error.status,
      statusText: error.statusText,
    };
  }
  if (error instanceof TRPCError) {
    return {
      errorType: "TRPCError",
      code: error.code,
    };
  }
  return {};
}

/**
 * Extracts the first meaningful stack frame location.
 * Used for error fingerprinting to group similar errors.
 * Skips node_modules and Node internals.
 */
function getStackLocation(err: Error): string {
  const lines = err.stack?.split("\n") ?? [];
  // Skip the first line (error message) and find first app frame
  for (const line of lines.slice(1)) {
    // Skip node internals and node_modules
    if (line.includes("node_modules") || line.includes("node:")) {
      continue;
    }

    // Match: "at functionName (file:line:col)" or "at file:line:col"
    const match = line.match(STACK_LOCATION_PATTERN);
    if (match) {
      const file = match[2];
      const lineNum = match[3];
      // Normalize path to be relative from src/
      const relativePath =
        file?.replace(SRC_PATH_PREFIX_PATTERN, "src/") ?? "unknown";
      return `${relativePath}:${lineNum}`;
    }
  }
  return "unknown";
}

/**
 * Creates a stable fingerprint for error grouping.
 * Similar errors will have the same fingerprint.
 * Includes first 100 chars of message for better grouping.
 */
function createFingerprint(err: Error): string {
  const location = getStackLocation(err);
  const messagePart = err.message.slice(0, 100);
  const input = `${err.name}:${messagePart}:${location}`;
  return createHash("sha256").update(input).digest("hex").slice(0, 12);
}

/**
 * Log an error with context and fingerprinting.
 * Returns the fingerprint for inclusion in error responses.
 *
 * @param error - The error to log
 * @param context - Additional context (requestId, path, etc.)
 * @param log - Logger instance (defaults to root logger)
 * @returns The error fingerprint (12 chars)
 */
export function logError(
  error: unknown,
  context: ErrorContext = {},
  log: Logger = logger
): string {
  const err = error instanceof Error ? error : new Error(String(error));
  const safeMessage = sanitizeLogMessage(err.message);
  const fingerprint = createFingerprint(err);
  const errorContext = extractErrorContext(error);
  const safeStack = err.stack
    ? err.stack.replace(err.message, safeMessage)
    : undefined;

  log.error(
    {
      ...context,
      ...errorContext,
      fingerprint,
      error: {
        name: err.name,
        message: safeMessage,
        stack: safeStack,
      },
    },
    `[${fingerprint}] ${safeMessage}`
  );

  return fingerprint;
}

/**
 * Log a warning for expected failures (validation, rate limits).
 * Does not include stack traces - these are expected conditions.
 *
 * @param message - Warning message
 * @param context - Additional context
 * @param log - Logger instance (defaults to root logger)
 */
export function logWarn(
  message: string,
  context: Record<string, unknown> = {},
  log: Logger = logger
): void {
  log.warn(context, sanitizeLogMessage(message));
}
