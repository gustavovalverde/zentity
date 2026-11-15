/**
 * Whether a database error is a unique-constraint violation.
 *
 * Drizzle wraps every libsql failure in a `DrizzleQueryError` whose message is
 * only the SQL text and which carries no `code`. The original `LibsqlError`
 * sits on `.cause`, so the whole chain is checked. Turso's remote client does
 * not set `extendedCode`, so the message is matched too.
 */
export function isUniqueConstraintError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
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
