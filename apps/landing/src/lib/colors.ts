/**
 * Centralized semantic color system for the landing page.
 * Single source of truth for all color usage across components.
 *
 * Uses Tailwind color classes with dark mode variants for proper APCA contrast.
 * - Light mode: 500-level for icons, 700-level for text (APCA 60+)
 * - Dark mode: 400-level for icons, 300-level for text (APCA 60+)
 */

export type SemanticColor =
  | "purple" // ZK/proofs
  | "blue" // FHE/encryption
  | "emerald" // success/commitments
  | "amber" // warning/passkeys
  | "orange" // crypto/exchanges
  | "pink" // age-restricted
  | "red" // error/destructive
  | "yellow"; // OCR/processing

export interface ColorStyle {
  /** Background color with opacity (e.g., bg-purple-500/10) */
  bg: string;
  /** Border color with opacity (e.g., border-purple-500/20) */
  border: string;
  /** Icon text color with dark mode variant */
  iconText: string;
  /** Body text color with dark mode variant (higher contrast) */
  text: string;
}

/**
 * Color styles for icon containers and text.
 * All colors have proper dark mode variants for accessibility.
 */
export const colorStyles: Record<SemanticColor, ColorStyle> = {
  purple: {
    bg: "bg-purple-500/10",
    border: "border-purple-500/20",
    iconText: "text-purple-500 dark:text-purple-400",
    text: "text-purple-700 dark:text-purple-300",
  },
  blue: {
    bg: "bg-blue-500/10",
    border: "border-blue-500/20",
    iconText: "text-blue-500 dark:text-blue-400",
    text: "text-blue-700 dark:text-blue-300",
  },
  emerald: {
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/20",
    iconText: "text-emerald-500 dark:text-emerald-400",
    text: "text-emerald-700 dark:text-emerald-300",
  },
  amber: {
    bg: "bg-amber-500/10",
    border: "border-amber-500/20",
    iconText: "text-amber-500 dark:text-amber-400",
    text: "text-amber-700 dark:text-amber-300",
  },
  orange: {
    bg: "bg-orange-500/10",
    border: "border-orange-500/20",
    iconText: "text-orange-500 dark:text-orange-400",
    text: "text-orange-700 dark:text-orange-300",
  },
  pink: {
    bg: "bg-pink-500/10",
    border: "border-pink-500/20",
    iconText: "text-pink-500 dark:text-pink-400",
    text: "text-pink-700 dark:text-pink-300",
  },
  red: {
    bg: "bg-red-500/10",
    border: "border-red-500/20",
    iconText: "text-red-500 dark:text-red-400",
    text: "text-red-700 dark:text-red-300",
  },
  yellow: {
    bg: "bg-yellow-500/10",
    border: "border-yellow-500/20",
    iconText: "text-yellow-500 dark:text-yellow-400",
    text: "text-yellow-700 dark:text-yellow-300",
  },
};

/**
 * Get a border class with custom opacity.
 * Useful for accent borders that need different emphasis.
 *
 * @param color - The semantic color
 * @param opacity - Opacity value (default: 20)
 * @returns Tailwind border class string
 */
export function getBorderClass(
  color: SemanticColor,
  opacity: number = 20,
): string {
  return `border-${color}-500/${opacity}`;
}
