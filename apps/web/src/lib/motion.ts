/**
 * Central place for motion/animation utility classNames.
 * Keeps micro-interactions consistent across components.
 * Respects user's prefers-reduced-motion preference for accessibility.
 */

/**
 * Standard motion classes for users who haven't requested reduced motion.
 */
export const motion = {
  fadeIn: "animate-in fade-in duration-300",
  slideUp: "animate-in fade-in slide-in-from-bottom-2 duration-300",
  pulse: "animate-pulse",
  zoomIn: "animate-in fade-in zoom-in-95 duration-200",
  progress: "transition-all duration-500",
  toastIn: "animate-in fade-in slide-in-from-bottom-4 duration-300",
};

/**
 * Reduced motion alternatives - minimal or no animations.
 * Applied when user has prefers-reduced-motion: reduce enabled.
 */
export const reducedMotion: typeof motion = {
  fadeIn: "", // No animation, instant appearance
  slideUp: "", // No animation, instant appearance
  pulse: "", // Remove pulsing to avoid distraction
  zoomIn: "", // No animation, instant appearance
  progress: "transition-opacity duration-150", // Keep brief opacity transition
  toastIn: "", // No animation, instant appearance
};

export type MotionKey = keyof typeof motion;

/**
 * Check if user prefers reduced motion.
 * Safe for SSR - returns false on server.
 */
export function getPrefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Get motion class based on user's motion preference.
 * @param key - The motion type to retrieve
 * @param forceReduced - Override to force reduced motion (useful for testing)
 * @returns The appropriate CSS class string
 */
export function getMotion(key: MotionKey, forceReduced?: boolean): string {
  const shouldReduce = forceReduced ?? getPrefersReducedMotion();
  return shouldReduce ? reducedMotion[key] : motion[key];
}

/**
 * Get all motion classes as an object based on user's motion preference.
 * Useful when you need multiple motion classes in a component.
 * @param forceReduced - Override to force reduced motion
 * @returns Motion classes object
 */
export function getMotionClasses(forceReduced?: boolean): typeof motion {
  const shouldReduce = forceReduced ?? getPrefersReducedMotion();
  return shouldReduce ? reducedMotion : motion;
}
