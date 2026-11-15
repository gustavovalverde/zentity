import { DrizzleQueryError } from "drizzle-orm";

/**
 * Whether a database error is a unique-constraint violation.
 *
 * Drizzle wraps every libsql failure in a `DrizzleQueryError` that carries no
 * `code`. Its message holds the failed SQL and its bound parameters, which can
 * include user-supplied text, so only its `.cause` is inspected. The original
 * `LibsqlError` sits there. Turso's remote client does not set `extendedCode`,
 * so the driver error's own message is matched too.
 */
export function isUniqueConstraintError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  if (error instanceof DrizzleQueryError) {
    return isUniqueConstraintError(error.cause);
  }
  if (
    ("code" in error && error.code === "SQLITE_CONSTRAINT_UNIQUE") ||
    ("extendedCode" in error &&
      error.extendedCode === "SQLITE_CONSTRAINT_UNIQUE")
  ) {
    return true;
  }
  if (error.message.includes("UNIQUE constraint failed")) {
    return true;
  }
  return isUniqueConstraintError(error.cause);
}
