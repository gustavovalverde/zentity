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

import { HttpError } from "@/lib/http/fetch";
import { FheServiceError } from "@/lib/privacy/fhe/backend";

import { type Logger, logger } from "./logger";
import { sanitizeLogMessage } from "./redact";

/** Matches stack trace location: "at functionName (file:line:col)" or "at file:line:col" */
const STACK_LOCATION_PATTERN = /at\s+(?:(.+?)\s+\()?(.+?):(\d+):\d+\)?/;

/** Matches path prefix up to and including /src/ for normalization */
const SRC_PATH_PREFIX_PATTERN = /^.*?\/src\//;

interface ErrorContext {
  duration?: number;
  operation?: string;
  path?: string;
  requestId?: string;
  userId?: string;
}

interface CauseFrame {
  code?: string;
  message: string;
  name: string;
}

/**
 * Walks `Error.cause` (up to MAX_CAUSE_DEPTH levels) to surface wrapped
 * error details. Drizzle wraps libsql errors as `Error("Failed query: ...")`
 * and stashes the original `LibsqlError` (with `code` and the actual
 * "UNIQUE constraint failed: <table>.<column>" message) on `.cause`. Surfacing
 * the chain makes the difference between "failed query" and the specific
 * constraint visible to operators without exposing it to the user.
 */
const MAX_CAUSE_DEPTH = 4;

function collectCauseChain(err: Error): CauseFrame[] {
  const frames: CauseFrame[] = [];
  let current: unknown = err.cause;
  let depth = 0;
  while (current instanceof Error && depth < MAX_CAUSE_DEPTH) {
    const frame: CauseFrame = {
      name: current.name,
      message: sanitizeLogMessage(current.message),
    };
    if ("code" in current && typeof current.code === "string") {
      frame.code = current.code;
    }
    frames.push(frame);
    current = current.cause;
    depth += 1;
  }
  return frames;
}

/**
 * Extracts structured context from known error types.
 * This provides richer log data for debugging without exposing sensitive info.
 */
function extractErrorContext(error: unknown): Record<string, unknown> {
  const ctx: Record<string, unknown> = {};

  if (error instanceof FheServiceError) {
    ctx.errorType = "FheServiceError";
    ctx.operation = error.operation;
    ctx.kind = error.kind;
    ctx.status = error.status;
  } else if (error instanceof HttpError) {
    ctx.errorType = "HttpError";
    ctx.status = error.status;
    ctx.statusText = error.statusText;
  } else if (error instanceof TRPCError) {
    ctx.errorType = "TRPCError";
    ctx.code = error.code;
  }

  if (error instanceof Error && error.cause) {
    const chain = collectCauseChain(error);
    if (chain.length > 0) {
      ctx.causeChain = chain;
    }
  }

  return ctx;
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
    const match = STACK_LOCATION_PATTERN.exec(line);
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
