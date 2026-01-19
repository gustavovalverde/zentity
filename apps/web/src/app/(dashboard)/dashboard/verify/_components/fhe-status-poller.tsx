"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

import { trpc } from "@/lib/trpc/client";

/**
 * FHE Status Poller
 *
 * Polls for FHE completion when ZK proofs are done but FHE is still pending.
 * Uses exponential backoff to reduce server load: 2s, 3s, 4.5s, 6.75s, 8s (capped).
 * Triggers a router refresh when FHE completes to update the tier display.
 */
export function FheStatusPoller() {
  const router = useRouter();
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptRef = useRef(0);

  useEffect(() => {
    const maxAttempts = 20;
    const baseInterval = 2000; // Start at 2s
    const maxInterval = 8000; // Cap at 8s
    const backoffFactor = 1.5;

    const scheduleNextPoll = () => {
      // Exponential backoff: baseInterval * (factor ^ attempt), capped at maxInterval
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
        // Ignore errors, will retry with backoff
      }

      attemptRef.current++;
      if (attemptRef.current < maxAttempts) {
        scheduleNextPoll();
      }
    };

    // Initial poll immediately
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
