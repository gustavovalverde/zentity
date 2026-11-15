/**
 * Birth date utilities
 *
 * Uses `dobDays` as u32 representing days since 1900-01-01 (UTC):
 * - Full date precision for regulatory compliance (exact DOB)
 * - Covers the vast majority of DOB values (including pre-1970 birth dates)
 * - Enables day-precise age calculations
 */

/** Zero-padded ISO 8601 calendar date, the only format OCR and ZKPassport hand over. */
const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Base date for `dobDays` calculations (UTC, day 0). */
const DOB_DAYS_BASE_DATE = new Date("1900-01-01T00:00:00Z");

/** Milliseconds per day */
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DAYS_PER_YEAR = 365.25;

/**
 * Parse a zero-padded `YYYY-MM-DD` string into a UTC Date.
 * Rejects every other format and calendar-impossible dates (e.g. 2023-02-30).
 */
function parseIsoDate(value: string | null | undefined): Date | undefined {
  const match = value ? ISO_DATE_PATTERN.exec(value) : null;
  if (!match) {
    return;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  // Date.UTC rolls impossible dates over (Feb 30 becomes Mar 2).
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
 * Convert a `YYYY-MM-DD` string to a `YYYYMMDD` integer (the doc_validity
 * circuit's date encoding), or null when it is not a valid calendar date.
 */
export function isoDateToInt(value: string | null | undefined): number | null {
  const date = parseIsoDate(value);
  if (!date) {
    return null;
  }
  return (
    date.getUTCFullYear() * 10_000 +
    (date.getUTCMonth() + 1) * 100 +
    date.getUTCDate()
  );
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
  const date = parseIsoDate(dateOfBirth);
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
  const date = parseIsoDate(dateOfBirth);
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

/**
 * Convert `dobDays` (days since 1900-01-01) to a birth year offset (uint8).
 * Used during verification to persist birth year offset for attestation.
 */
export function dobDaysToBirthYearOffset(
  dobDays: number | null | undefined
): number | null {
  if (dobDays === null || dobDays === undefined) {
    return null;
  }
  const birthDate = new Date(
    DOB_DAYS_BASE_DATE.getTime() + dobDays * MS_PER_DAY
  );
  const birthYear = birthDate.getUTCFullYear();
  const offset = birthYear - 1900;
  return offset >= 0 && offset <= 255 ? offset : null;
}
