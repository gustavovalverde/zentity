/**
 * Shared date parsing utilities for identity verification.
 */

const NON_DIGIT_REGEX = /\D/g;

/**
 * Parses a date string (e.g., "1990-05-15" or "15/05/1990") into an integer
 * in YYYYMMDD format (e.g., 19900515).
 *
 * Returns null if the input is invalid or has fewer than 8 digits.
 */
export function parseDateToInt(
  value: string | null | undefined
): number | null {
  if (!value) {
    return null;
  }
  const digits = value.replaceAll(NON_DIGIT_REGEX, "");
  if (digits.length < 8) {
    return null;
  }
  const dateInt = Number(digits.slice(0, 8));
  return Number.isFinite(dateInt) ? dateInt : null;
}
