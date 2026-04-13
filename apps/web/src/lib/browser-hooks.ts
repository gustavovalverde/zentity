"use client";

/**
 * Client-environment hooks.
 *
 * State that is only knowable after the first client render: viewport width,
 * device type, orientation, and hydration status. All three return stable
 * SSR-safe initial values to prevent hydration mismatches.
 */

import { useEffect, useState } from "react";

const MOBILE_BREAKPOINT = 768;
const MOBILE_DEVICE_PATTERN = /Android|iPhone|iPad/i;
const MACINTOSH_PATTERN = /Macintosh/i;

/**
 * True on viewports narrower than 768px. Returns `undefined` during SSR so
 * callers can render a loading state and avoid desktop→mobile layout flash.
 */
export function useIsMobile(): boolean | undefined {
  const [isMobile, setIsMobile] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    const mql = globalThis.window.matchMedia(
      `(max-width: ${MOBILE_BREAKPOINT - 1}px)`
    );
    const onChange = () => {
      setIsMobile(globalThis.window.innerWidth < MOBILE_BREAKPOINT);
    };
    mql.addEventListener("change", onChange);
    setIsMobile(globalThis.window.innerWidth < MOBILE_BREAKPOINT);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return isMobile;
}

/**
 * Detects a mobile device via user agent + touch support (handles newer
 * iPads that report as Macintosh), and tracks orientation changes.
 * Based on AWS Amplify FaceLivenessDetector patterns.
 */
export function useMobileDetect() {
  const [isMobile, setIsMobile] = useState(false);
  const [isLandscape, setIsLandscape] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      const isMobileDevice =
        MOBILE_DEVICE_PATTERN.test(navigator.userAgent) ||
        (navigator.maxTouchPoints > 1 &&
          MACINTOSH_PATTERN.test(navigator.userAgent));
      setIsMobile(isMobileDevice);
    };

    const landscapeQuery = globalThis.window.matchMedia(
      "(orientation: landscape)"
    );
    const handleOrientation = (e: MediaQueryListEvent) => {
      setIsLandscape(e.matches);
    };

    checkMobile();
    setIsLandscape(landscapeQuery.matches);
    landscapeQuery.addEventListener("change", handleOrientation);

    return () => {
      landscapeQuery.removeEventListener("change", handleOrientation);
    };
  }, []);

  return { isMobile, isLandscape };
}

/**
 * Returns `false` during SSR and `true` after the component mounts on the
 * client. Use to guard rendering of components that depend on client-only
 * state (wallet connection, storage, etc.) without hydration mismatches.
 */
export function useIsMounted(): boolean {
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  return isMounted;
}
