/**
 * Name utilities for Zentity
 *
 * Handles name formatting for display purposes:
 * - Welcome messages use first part of first name (e.g., "Juan" from "Juan Carlos")
 * - Display name combines first parts of first and last name (e.g., "Juan Perez")
 *
 * Note: These utilities work with transient name data during verification.
 * The actual names are NOT stored - only cryptographic commitments are persisted.
 */

/** Matches one or more whitespace characters for splitting names */
const WHITESPACE_PATTERN = /\s+/;

/**
 * Extracts the first part (first word) from a name string.
 *
 * @example
 * getFirstPart("Juan Carlos") // "Juan"
 * getFirstPart("Perez Garcia") // "Perez"
 * getFirstPart("Ana") // "Ana"
 * getFirstPart("") // ""
 */
export function getFirstPart(name: string | undefined | null): string {
  if (!name) {
    return "";
  }
  const trimmed = name.trim();
  const firstSpace = trimmed.indexOf(" ");
  return firstSpace === -1 ? trimmed : trimmed.substring(0, firstSpace);
}

/**
 * Builds a display name from first name and last name by combining
 * the first parts of each.
 *
 * @example
 * buildDisplayName("Juan Carlos", "Perez Garcia") // "Juan Perez"
 * buildDisplayName("Ana Maria", "Rodriguez") // "Ana Rodriguez"
 * buildDisplayName("Juan", "Perez") // "Juan Perez"
 * buildDisplayName("Juan Carlos", undefined) // "Juan"
 */
export function buildDisplayName(
  firstName: string | undefined | null,
  lastName: string | undefined | null
): string {
  const firstPart = getFirstPart(firstName);
  const lastPart = getFirstPart(lastName);

  if (firstPart && lastPart) {
    return `${firstPart} ${lastPart}`;
  }
  return firstPart || lastPart || "";
}

/**
 * Builds a display name from a full name string by extracting what appears
 * to be the first name and last name portions.
 *
 * This is a fallback when firstName and lastName aren't available separately.
 * It assumes the format is "FirstName(s) LastName(s)" and takes the first
 * word from each portion.
 *
 * @example
 * buildDisplayNameFromFull("Juan Carlos Perez Garcia") // "Juan Perez" (heuristic)
 * buildDisplayNameFromFull("Ana Rodriguez") // "Ana Rodriguez"
 */
function _buildDisplayNameFromFull(
  fullName: string | undefined | null
): string {
  if (!fullName) {
    return "";
  }

  const parts = fullName.trim().split(WHITESPACE_PATTERN);

  // If only one or two words, return as-is
  if (parts.length <= 2) {
    return parts.join(" ");
  }

  // For names with 3+ parts, assume first half is first name, second half is last name
  // e.g., "Juan Carlos Perez Garcia" -> first: "Juan Carlos", last: "Perez Garcia"
  const midpoint = Math.ceil(parts.length / 2);
  const firstNameParts = parts.slice(0, midpoint);
  const lastNameParts = parts.slice(midpoint);

  // Take first word from each
  const firstName = firstNameParts[0] || "";
  const lastName = lastNameParts[0] || "";

  if (firstName && lastName) {
    return `${firstName} ${lastName}`;
  }
  return firstName || lastName;
}
