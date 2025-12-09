"use client";

import { useState, useEffect, useRef } from "react";

/**
 * Hook that delays showing loading indicators to prevent flicker.
 *
 * Per Vercel Design Guidelines:
 * - Show spinners/skeletons with ~150-300ms delay
 * - Minimum visibility of ~300-500ms once shown to avoid flicker
 *
 * @param isLoading - Whether the content is currently loading
 * @param options - Configuration options
 * @param options.showDelay - Delay before showing loading indicator (default: 200ms)
 * @param options.minShowTime - Minimum time to show indicator once visible (default: 300ms)
 * @returns Whether the loading indicator should be visible
 *
 * @example
 * ```tsx
 * function MyComponent({ isLoading }) {
 *   const showSkeleton = useDelayedVisibility(isLoading);
 *
 *   if (showSkeleton) {
 *     return <Skeleton />;
 *   }
 *
 *   return <ActualContent />;
 * }
 * ```
 */
export function useDelayedVisibility(
  isLoading: boolean,
  options: {
    showDelay?: number;
    minShowTime?: number;
  } = {}
): boolean {
  const { showDelay = 200, minShowTime = 300 } = options;

  const [isVisible, setIsVisible] = useState(false);
  const showTimeRef = useRef<number | null>(null);
  const showTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Clear any pending timeouts
    const clearTimeouts = () => {
      if (showTimeoutRef.current) {
        clearTimeout(showTimeoutRef.current);
        showTimeoutRef.current = null;
      }
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
        hideTimeoutRef.current = null;
      }
    };

    if (isLoading) {
      // Start loading - delay showing the indicator
      if (!isVisible) {
        showTimeoutRef.current = setTimeout(() => {
          setIsVisible(true);
          showTimeRef.current = Date.now();
        }, showDelay);
      }
    } else {
      // Finished loading
      clearTimeouts();

      if (isVisible && showTimeRef.current) {
        // Ensure minimum show time
        const elapsed = Date.now() - showTimeRef.current;
        const remaining = minShowTime - elapsed;

        if (remaining > 0) {
          hideTimeoutRef.current = setTimeout(() => {
            setIsVisible(false);
            showTimeRef.current = null;
          }, remaining);
        } else {
          setIsVisible(false);
          showTimeRef.current = null;
        }
      } else {
        // Never showed, just reset
        setIsVisible(false);
        showTimeRef.current = null;
      }
    }

    return clearTimeouts;
  }, [isLoading, isVisible, showDelay, minShowTime]);

  return isVisible;
}

/**
 * Simpler version that only delays showing, no minimum show time.
 * Use when you just want to prevent flicker for fast operations.
 *
 * @param isLoading - Whether the content is currently loading
 * @param delay - Delay before showing loading indicator (default: 200ms)
 * @returns Whether the loading indicator should be visible
 */
export function useDelayedShow(isLoading: boolean, delay = 200): boolean {
  const [isVisible, setIsVisible] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    if (isLoading) {
      timeoutRef.current = setTimeout(() => {
        setIsVisible(true);
      }, delay);
    } else {
      setIsVisible(false);
    }

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [isLoading, delay]);

  return isVisible;
}
