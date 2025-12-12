/**
 * Simple logger utility that respects environment.
 * In production, logs are suppressed unless explicitly enabled.
 */

type LogLevel = "debug" | "info" | "warn" | "error";

interface LoggerConfig {
  enabled: boolean;
  level: LogLevel;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function getConfig(): LoggerConfig {
  const isDev = process.env.NODE_ENV === "development";
  const isTest = process.env.NODE_ENV === "test";
  const forceEnable = process.env.ENABLE_LOGGING === "true";

  return {
    enabled: isDev || forceEnable,
    level: isTest ? "error" : "debug",
  };
}

function shouldLog(level: LogLevel): boolean {
  const config = getConfig();
  if (!config.enabled) return false;
  return LOG_LEVELS[level] >= LOG_LEVELS[config.level];
}

function formatPrefix(level: LogLevel, context?: string): string {
  const timestamp = new Date().toISOString();
  const contextStr = context ? `[${context}]` : "";
  return `${timestamp} ${level.toUpperCase()}${contextStr}`;
}

export const logger = {
  debug(message: string, ...args: unknown[]): void {
    if (shouldLog("debug")) {
      // biome-ignore lint/suspicious/noConsole: Logger utility wraps console
      console.debug(formatPrefix("debug"), message, ...args);
    }
  },

  info(message: string, ...args: unknown[]): void {
    if (shouldLog("info")) {
      // biome-ignore lint/suspicious/noConsole: Logger utility wraps console
      console.info(formatPrefix("info"), message, ...args);
    }
  },

  warn(message: string, ...args: unknown[]): void {
    if (shouldLog("warn")) {
      // biome-ignore lint/suspicious/noConsole: Logger utility wraps console
      console.warn(formatPrefix("warn"), message, ...args);
    }
  },

  error(message: string, ...args: unknown[]): void {
    if (shouldLog("error")) {
      // biome-ignore lint/suspicious/noConsole: Logger utility wraps console
      console.error(formatPrefix("error"), message, ...args);
    }
  },

  /**
   * Create a logger with a specific context prefix.
   * Example: const log = logger.withContext("face-match");
   */
  withContext(context: string) {
    return {
      debug: (message: string, ...args: unknown[]) => {
        if (shouldLog("debug")) {
          // biome-ignore lint/suspicious/noConsole: Logger utility wraps console
          console.debug(formatPrefix("debug", context), message, ...args);
        }
      },
      info: (message: string, ...args: unknown[]) => {
        if (shouldLog("info")) {
          // biome-ignore lint/suspicious/noConsole: Logger utility wraps console
          console.info(formatPrefix("info", context), message, ...args);
        }
      },
      warn: (message: string, ...args: unknown[]) => {
        if (shouldLog("warn")) {
          // biome-ignore lint/suspicious/noConsole: Logger utility wraps console
          console.warn(formatPrefix("warn", context), message, ...args);
        }
      },
      error: (message: string, ...args: unknown[]) => {
        if (shouldLog("error")) {
          // biome-ignore lint/suspicious/noConsole: Logger utility wraps console
          console.error(formatPrefix("error", context), message, ...args);
        }
      },
    };
  },
};

export default logger;
