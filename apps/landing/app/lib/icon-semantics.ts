import { colorStyles } from "@/lib/colors";

/**
 * Semantic icon colors for landing sections.
 * Keep concept -> color mapping stable to avoid visual drift.
 */
export const iconSemanticColors = {
  shield: colorStyles.purple.iconText,
  lock: colorStyles.blue.iconText,
  key: colorStyles.amber.iconText,
  commitment: colorStyles.emerald.iconText,
  company: colorStyles.orange.iconText,
  developer: colorStyles.blue.iconText,
  exchange: colorStyles.orange.iconText,
  ageGate: colorStyles.pink.iconText,
  employment: colorStyles.blue.iconText,
  residency: colorStyles.emerald.iconText,
  oauth: colorStyles.purple.iconText,
  portability: colorStyles.amber.iconText,
  compliance: colorStyles.emerald.iconText,
} as const;
