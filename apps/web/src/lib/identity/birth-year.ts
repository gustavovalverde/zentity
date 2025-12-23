/**
 * Birth year utilities
 *
 * On-chain attestations store `birthYearOffset` as a uint8 (0-255) representing
 * years since 1900. This encodes birth years in the range 1900-2155.
 */

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
  dateOfBirth: string | undefined,
): number | undefined {
  if (!dateOfBirth) return undefined;

  const value = dateOfBirth.trim();
  if (!value) return undefined;

  const separator = value.includes("/")
    ? "/"
    : value.includes("-")
      ? "-"
      : null;
  if (!separator) return undefined;

  const parts = value.split(separator).map((part) => part.trim());
  if (parts.length !== 3) return undefined;

  const first = parts[0];
  const last = parts[2];

  let yearPart: string | undefined;
  if (/^\d{4}$/.test(first)) yearPart = first;
  else if (/^\d{4}$/.test(last)) yearPart = last;
  else yearPart = parts.find((part) => /^\d{4}$/.test(part));

  if (!yearPart) return undefined;

  const birthYear = Number.parseInt(yearPart, 10);
  if (Number.isNaN(birthYear)) return undefined;

  return birthYear;
}

/**
 * Calculate birth year offset (years since 1900) from a DOB string.
 */
export function calculateBirthYearOffset(
  dateOfBirth: string | undefined,
): number | undefined {
  const birthYear = parseBirthYearFromDob(dateOfBirth);
  if (birthYear === undefined) return undefined;

  const currentYear = new Date().getFullYear();
  if (birthYear < 1900 || birthYear > currentYear) return undefined;

  const offset = birthYear - 1900;
  if (offset < 0 || offset > 255) return undefined;

  return offset;
}
