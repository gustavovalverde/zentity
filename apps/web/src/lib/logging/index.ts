import "server-only";

/**
 * Structured Logging Module
 *
 * Public API for structured logging throughout the application.
 *
 * @example tRPC router usage (via middleware context)
 * ```ts
 * ctx.log.info({ documentId }, "Document processed");
 * ctx.log.warn({ reason }, "Validation failed");
 * if (ctx.debug) ctx.log.debug({ scores }, "Detection metrics");
 * ```
 *
 * @example Error logging
 * ```ts
 * import { logError, logWarn } from "@/lib/logging";
 * const fingerprint = logError(error, { path: "identity.verify" });
 * logWarn("Rate limit exceeded", { scope: "identity.processDocument" });
 * ```
 *
 * @example Standalone logger (outside tRPC)
 * ```ts
 * import { logger } from "@/lib/logging";
 * logger.info({ event: "startup" }, "Server starting");
 * ```
 */

// Error logging exports
export { logError, logWarn } from "./error-logger";
// Logger exports
export {
  createRequestLogger,
  isDebugEnabled,
  type Logger,
  logger,
} from "./logger";
// Redaction exports
export {
  extractInputMeta,
  REDACT_KEYS,
  sanitizeForLog,
  sanitizeLogMessage,
} from "./redact";
