const DATE_FORMAT = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "numeric",
});

/**
 * Formats a date for display in the viewer's locale, for example "Jan 5, 2026".
 * Returns `fallback` when the value is empty or not a valid date.
 */
export function formatDate(
  value: string | Date | null | undefined,
  fallback: string
): string {
  if (!value) {
    return fallback;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : DATE_FORMAT.format(date);
}
