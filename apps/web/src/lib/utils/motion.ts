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
