/**
 * Birth year utilities
 *
 * On-chain attestations store `birthYearOffset` as a uint8 (0-255) representing
 * years since 1900. This encodes birth years in the range 1900-2155.
 */

/** Matches exactly 4 digits (for year validation) */
const FOUR_DIGIT_YEAR_PATTERN = /^\d{4}$/;

/**
 * Extract a 4-digit birth year from common DOB formats.
 *
 * Supported formats (as produced by OCR):
 * - YYYY-MM-DD
 * - DD/MM/YYYY
 * - YYYY/MM/DD
 * - DD-MM-YYYY
 */
export function parseBirthYearFromDob(
  dateOfBirth: string | undefined
): number | undefined {
  if (!dateOfBirth) {
    return;
  }

  const value = dateOfBirth.trim();
  if (!value) {
    return;
  }

  let separator: string | null;
  if (value.includes("/")) {
    separator = "/";
  } else if (value.includes("-")) {
    separator = "-";
  } else {
    separator = null;
  }
  if (!separator) {
    return;
  }

  const parts = value.split(separator).map((part) => part.trim());
  if (parts.length !== 3) {
    return;
  }

  const first = parts[0];
  const last = parts[2];

  let yearPart: string | undefined;
  if (FOUR_DIGIT_YEAR_PATTERN.test(first)) {
    yearPart = first;
  } else if (FOUR_DIGIT_YEAR_PATTERN.test(last)) {
    yearPart = last;
  } else {
    yearPart = parts.find((part) => FOUR_DIGIT_YEAR_PATTERN.test(part));
  }

  if (!yearPart) {
    return;
  }

  const birthYear = Number.parseInt(yearPart, 10);
  if (Number.isNaN(birthYear)) {
    return;
  }

  return birthYear;
}

/**
 * Calculate birth year offset (years since 1900) from a DOB string.
 */
export function calculateBirthYearOffset(
  dateOfBirth: string | undefined
): number | undefined {
  const birthYear = parseBirthYearFromDob(dateOfBirth);
  if (birthYear === undefined) {
    return;
  }

  const currentYear = new Date().getFullYear();
  if (birthYear < 1900 || birthYear > currentYear) {
    return;
  }

  const offset = birthYear - 1900;
  if (offset < 0 || offset > 255) {
    return;
  }

  return offset;
}
