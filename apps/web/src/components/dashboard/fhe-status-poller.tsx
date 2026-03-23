"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

import { trpc } from "@/lib/trpc/client";

/**
 * Poll for FHE completion after proofs are already stored.
 * Refreshes the current route once the assurance profile reports completion.
 */
export function FheStatusPoller() {
  const router = useRouter();
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptRef = useRef(0);

  useEffect(() => {
    const maxAttempts = 20;
    const baseInterval = 2000;
    const maxInterval = 8000;
    const backoffFactor = 1.5;

    const scheduleNextPoll = () => {
      const interval = Math.min(
        baseInterval * backoffFactor ** attemptRef.current,
        maxInterval
      );
      timeoutRef.current = setTimeout(poll, interval);
    };

    const poll = async () => {
      try {
        const status = await trpc.assurance.profile.query();
        if (status.details.fheComplete || status.tier >= 2) {
          if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
            timeoutRef.current = null;
          }
          router.refresh();
          return;
        }
      } catch {
        // Ignore transient errors and keep polling.
      }

      attemptRef.current++;
      if (attemptRef.current < maxAttempts) {
        scheduleNextPoll();
      }
    };

    poll();

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [router]);

  return null;
}
