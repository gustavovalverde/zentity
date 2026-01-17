"use client";

import { useEffect, useState } from "react";

/** Regex pattern for mobile devices (Android, iPhone, iPad) */
const MOBILE_DEVICE_PATTERN = /Android|iPhone|iPad/i;

/** Regex pattern for newer iPads that report as Macintosh */
const MACINTOSH_PATTERN = /Macintosh/i;

/**
 * Detects if the current device is mobile and tracks orientation.
 * Based on AWS Amplify FaceLivenessDetector patterns.
 */
export function useMobileDetect() {
  const [isMobile, setIsMobile] = useState(false);
  const [isLandscape, setIsLandscape] = useState(false);

  useEffect(() => {
    // Check mobile via user agent + touch support (handles newer iPads)
    const checkMobile = () => {
      const isMobileDevice =
        MOBILE_DEVICE_PATTERN.test(navigator.userAgent) ||
        (navigator.maxTouchPoints > 1 &&
          MACINTOSH_PATTERN.test(navigator.userAgent));
      setIsMobile(isMobileDevice);
    };

    // Listen for orientation changes
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
