import crypto from "node:crypto";

/** Matches Unicode diacritical marks for name normalization */
const DIACRITICS_PATTERN = /[\u0300-\u036f]/g;

/** Matches a string containing only digits */
const DIGITS_ONLY_PATTERN = /^\d+$/;

/** Matches one or more whitespace characters for splitting names */
const WHITESPACE_PATTERN = /\s+/;

export function parseBirthYear(dateValue?: string | null): number | null {
  if (!dateValue) {
    return null;
  }
  if (dateValue.includes("/")) {
    const parts = dateValue.split("/");
    if (parts.length === 3) {
      const year = Number.parseInt(parts[2] ?? "", 10);
      return Number.isFinite(year) ? year : null;
    }
  }
  if (dateValue.includes("-")) {
    const parts = dateValue.split("-");
    if (parts.length >= 1) {
      const year = Number.parseInt(parts[0] ?? "", 10);
      return Number.isFinite(year) ? year : null;
    }
  }
  if (dateValue.length === 8) {
    const year = Number.parseInt(dateValue.slice(0, 4), 10);
    return Number.isFinite(year) ? year : null;
  }
  return null;
}

export function parseDateToInt(dateValue?: string | null): number | null {
  if (!dateValue) {
    return null;
  }
  if (dateValue.includes("/")) {
    const parts = dateValue.split("/");
    if (parts.length === 3) {
      const month = Number.parseInt(parts[0] ?? "", 10);
      const day = Number.parseInt(parts[1] ?? "", 10);
      const year = Number.parseInt(parts[2] ?? "", 10);
      if (
        Number.isFinite(year) &&
        Number.isFinite(month) &&
        Number.isFinite(day)
      ) {
        return year * 10_000 + month * 100 + day;
      }
    }
  }
  if (dateValue.includes("-")) {
    const parts = dateValue.split("-");
    if (parts.length === 3) {
      const year = Number.parseInt(parts[0] ?? "", 10);
      const month = Number.parseInt(parts[1] ?? "", 10);
      const day = Number.parseInt(parts[2] ?? "", 10);
      if (
        Number.isFinite(year) &&
        Number.isFinite(month) &&
        Number.isFinite(day)
      ) {
        return year * 10_000 + month * 100 + day;
      }
    }
  }
  if (dateValue.length === 8 && DIGITS_ONLY_PATTERN.test(dateValue)) {
    const year = Number.parseInt(dateValue.slice(0, 4), 10);
    const month = Number.parseInt(dateValue.slice(4, 6), 10);
    const day = Number.parseInt(dateValue.slice(6, 8), 10);
    if (
      Number.isFinite(year) &&
      Number.isFinite(month) &&
      Number.isFinite(day)
    ) {
      return year * 10_000 + month * 100 + day;
    }
  }
  return null;
}

/**
 * Normalizes a name for commitment generation.
 * Removes diacritics, uppercases, and collapses whitespace.
 */
export function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replaceAll(DIACRITICS_PATTERN, "")
    .toUpperCase()
    .split(WHITESPACE_PATTERN)
    .filter(Boolean)
    .join(" ");
}

/**
 * Generates a SHA-256 commitment of the normalized name with user salt.
 * Used for privacy-preserving name verification.
 */
export function generateNameCommitment(
  fullName: string,
  userSalt: string
): string {
  const normalized = normalizeName(fullName);
  const data = `${normalized}:${userSalt}`;
  return crypto.createHash("sha256").update(data).digest("hex");
}
