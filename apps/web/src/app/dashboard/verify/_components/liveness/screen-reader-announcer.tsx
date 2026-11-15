"use client";

import { useEffect, useRef, useState } from "react";

interface ScreenReaderAnnouncerProps {
  /** Message to announce. Changes trigger new announcements. */
  message: string | null;
  /** ARIA live priority - use "assertive" for time-critical messages */
  priority?: "polite" | "assertive";
}

/**
 * Dedicated screen reader announcer for liveness hints.
 *
 * Provides cleaner announcements than aria-live on visible elements
 * by using a visually hidden (sr-only) element with proper announcement timing.
 *
 * Based on AWS Amplify FaceLivenessDetector accessibility patterns.
 */
export function ScreenReaderAnnouncer({
  message,
  priority = "polite",
}: Readonly<ScreenReaderAnnouncerProps>) {
  const [announcement, setAnnouncement] = useState("");
  const prevMessageRef = useRef<string | null>(null);

  useEffect(() => {
    if (message && message !== prevMessageRef.current) {
      // Clear then set to force screen reader re-announcement
      // This ensures the same message can be announced multiple times
      setAnnouncement("");

      // Use requestAnimationFrame to ensure the clear is processed
      // before setting the new value
      requestAnimationFrame(() => {
        setAnnouncement(message);
      });

      prevMessageRef.current = message;
    }
  }, [message]);

  return (
    <span
      aria-atomic="true"
      aria-live={priority}
      className="sr-only"
      role={priority === "assertive" ? "alert" : "status"}
    >
      {announcement}
    </span>
  );
}
