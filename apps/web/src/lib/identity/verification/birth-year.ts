/**
 * Birth date utilities
 *
 * Uses `dobDays` as u32 representing days since 1900-01-01 (UTC):
 * - Full date precision for regulatory compliance (exact DOB)
 * - Covers the vast majority of DOB values (including pre-1970 birth dates)
 * - Enables day-precise age calculations
 */

/** Matches exactly 4 digits (for year validation) */
const FOUR_DIGIT_YEAR_PATTERN = /^\d{4}$/;

/** Base date for `dobDays` calculations (UTC, day 0). */
const DOB_DAYS_BASE_DATE = new Date("1900-01-01T00:00:00Z");

/** Milliseconds per day */
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DAYS_PER_YEAR = 365.25;

/**
 * Parse a DOB string into a Date object.
 *
 * Supported formats:
 * - YYYY-MM-DD (ISO 8601)
 * - DD/MM/YYYY
 * - YYYY/MM/DD
 * - DD-MM-YYYY
 */
export function parseDob(dateOfBirth: string | undefined): Date | undefined {
  if (!dateOfBirth) {
    return;
  }

  const value = dateOfBirth.trim();
  if (!value) {
    return;
  }

  let separator: string | undefined;
  if (value.includes("/")) {
    separator = "/";
  } else if (value.includes("-")) {
    separator = "-";
  }

  if (!separator) {
    return;
  }

  const parts = value.split(separator).map((part) => part.trim());
  if (parts.length !== 3) {
    return;
  }

  let year: number;
  let month: number;
  let day: number;

  const first = parts[0];
  const middle = parts[1];
  const last = parts[2];

  if (FOUR_DIGIT_YEAR_PATTERN.test(first)) {
    // YYYY-MM-DD or YYYY/MM/DD
    year = Number.parseInt(first, 10);
    month = Number.parseInt(middle, 10);
    day = Number.parseInt(last, 10);
  } else if (FOUR_DIGIT_YEAR_PATTERN.test(last)) {
    // DD/MM/YYYY or DD-MM-YYYY
    day = Number.parseInt(first, 10);
    month = Number.parseInt(middle, 10);
    year = Number.parseInt(last, 10);
  } else {
    return;
  }

  if (Number.isNaN(year) || Number.isNaN(month) || Number.isNaN(day)) {
    return;
  }

  // Validate ranges
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return;
  }

  // Create UTC date to avoid timezone issues
  const date = new Date(Date.UTC(year, month - 1, day));

  // Verify the date is valid (e.g., Feb 30 would roll over)
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return;
  }

  return date;
}

/**
 * Convert a DOB string to `dobDays` (days since 1900-01-01, UTC).
 *
 * This provides full date precision for regulatory compliance.
 * Returns undefined for dates before 1900-01-01.
 */
export function dobToDaysSince1900(
  dateOfBirth: string | undefined
): number | undefined {
  const date = parseDob(dateOfBirth);
  if (!date) {
    return;
  }

  const diffMs = date.getTime() - DOB_DAYS_BASE_DATE.getTime();
  if (diffMs < 0) {
    // Date is before supported base date - not supported in this format
    return;
  }

  return Math.floor(diffMs / MS_PER_DAY);
}

/**
 * Get today's date as `dobDays` (days since 1900-01-01, UTC).
 */
export function getTodayDobDays(): number {
  const now = new Date();
  const todayUtc = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );
  const diffMs = todayUtc.getTime() - DOB_DAYS_BASE_DATE.getTime();
  return Math.floor(diffMs / MS_PER_DAY);
}

/**
 * Convert an age threshold in years to a days threshold, using 365.25 days/year.
 *
 * This intentionally approximates leap years without requiring calendar
 * operations in circuits.
 */
export function minAgeYearsToDays(minAgeYears: number): number {
  if (!Number.isFinite(minAgeYears) || minAgeYears < 0) {
    return 0;
  }
  return Math.floor(minAgeYears * DAYS_PER_YEAR);
}

/**
 * Parse the birth year (4-digit integer) from a DOB string.
 * Used for profile display, not for FHE (which uses dobDays).
 */
export function parseBirthYearFromDob(
  dateOfBirth: string | undefined
): number | undefined {
  const date = parseDob(dateOfBirth);
  if (!date) {
    return;
  }
  return date.getUTCFullYear();
}

/**
 * Calculate birth year offset from a 4-digit year.
 * Used for blockchain attestation (smart contracts use uint8 offset from 1900).
 * Not used for FHE (which uses dobDays).
 */
export function calculateBirthYearOffsetFromYear(
  birthYear: number | undefined | null
): number | undefined {
  if (birthYear === undefined || birthYear === null) {
    return;
  }
  const offset = birthYear - 1900;
  if (offset < 0 || offset > 255) {
    return;
  }
  return offset;
}
