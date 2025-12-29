/**
 * Pino Logger Configuration
 *
 * Single source of truth for structured logging configuration.
 * - JSON output in production, pretty-print in development
 * - Built-in PII redaction via Pino's redact option
 * - Child loggers for request correlation
 */
import "server-only";

import pino, { type Logger } from "pino";

import { REDACT_KEYS } from "./redact";

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

  // Pretty-print in dev, structured JSON in production
  ...(isDev && {
    transport: {
      target: "pino-pretty",
      options: {
        colorize: true,
        translateTime: "HH:MM:ss.l",
        ignore: "pid,hostname",
      },
    },
  }),

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
export function createRequestLogger(requestId: string): Logger {
  return logger.child({ requestId });
}

/**
 * Check if debug logging is enabled (LOG_LEVEL=debug).
 */
export function isDebugEnabled(): boolean {
  return logLevel === "debug";
}

export type { Logger };
