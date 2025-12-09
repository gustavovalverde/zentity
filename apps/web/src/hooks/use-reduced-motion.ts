"use client";

import { useEffect, useState } from "react";

/**
 * React hook that subscribes to the user's motion preference.
 * Automatically updates when the user changes their system setting.
 *
 * @returns true if the user prefers reduced motion, false otherwise
 *
 * @example
 * ```tsx
 * function AnimatedComponent() {
 *   const prefersReducedMotion = usePrefersReducedMotion();
 *   return (
 *     <div className={prefersReducedMotion ? "" : "animate-bounce"}>
 *       Content
 *     </div>
 *   );
 * }
 * ```
 */
export function usePrefersReducedMotion(): boolean {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

    // Set initial value
    setPrefersReducedMotion(mediaQuery.matches);

    // Listen for changes
    const handleChange = (event: MediaQueryListEvent) => {
      setPrefersReducedMotion(event.matches);
    };

    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  return prefersReducedMotion;
}
