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
