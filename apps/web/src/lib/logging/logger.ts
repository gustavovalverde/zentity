/**
 * Pino Logger Configuration
 *
 * Single source of truth for structured logging configuration.
 * - JSON output in production and development (Turbopack incompatible with pino transports)
 * - Built-in PII redaction via Pino's redact option
 * - Child loggers for request correlation
 *
 * NOTE: pino-pretty transport is NOT used because Next.js Turbopack cannot resolve
 * pino's dynamically-generated worker modules. Structured JSON is used in all environments.
 * For human-readable dev logs, pipe output through pino-pretty CLI:
 *   pnpm run dev | pino-pretty
 */
import "server-only";

import pino from "pino";

import { REDACT_KEYS } from "./redact";

export type Logger = import("pino").Logger;

const isDev = process.env.NODE_ENV !== "production";
const logLevel = process.env.LOG_LEVEL || (isDev ? "debug" : "info");

/**
 * Base logger instance - created once at module load.
 * Use createRequestLogger() for request-scoped logging.
 */
const redactPaths = [
  // Request/auth data
  "req.headers.authorization",
  "req.headers.cookie",
  'req.headers["x-zentity-internal-token"]',

  // Canonical redaction keys (nested with wildcard)
  ...Array.from(REDACT_KEYS, (key) => `*.${key}`),
];

export const logger: Logger = pino({
  level: logLevel,

  // Base context for all logs
  base: {
    service: "zentity-web",
    env: process.env.NODE_ENV || "development",
  },

  // Pino's built-in redaction (fast, runs before serialization)
  redact: {
    paths: redactPaths,
    censor: "[REDACTED]",
  },

  // Custom serializers
  serializers: {
    err: pino.stdSerializers.err,
    // Minimal request serialization (no headers/cookies)
    req: (req: Request) => ({
      method: req.method,
      url: new URL(req.url).pathname,
    }),
  },
});

/**
 * Creates a child logger with request-scoped context.
 * Used by tRPC middleware to correlate logs within a request.
 *
 * @param requestId - Unique ID for the request (UUID)
 */
export function createRequestLogger(
  requestId: string,
  bindings?: Record<string, unknown>
): Logger {
  return logger.child({ requestId, ...bindings });
}

/**
 * Check if debug logging is enabled (LOG_LEVEL=debug).
 */
export function isDebugEnabled(): boolean {
  return logLevel === "debug";
}
