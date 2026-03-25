"use client";

import { useRouter } from "next/navigation";
import { startTransition, useEffect, useRef } from "react";

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
    const baseInterval = 2000;
    const maxInterval = 8000;
    const backoffFactor = 1.5;
    let disposed = false;

    const clearPendingPoll = () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };

    const scheduleNextPoll = () => {
      if (disposed) {
        return;
      }
      const interval = Math.min(
        baseInterval * backoffFactor ** attemptRef.current,
        maxInterval
      );
      timeoutRef.current = setTimeout(poll, interval);
    };

    const poll = async () => {
      try {
        const status = await trpc.assurance.profile.query();
        if (disposed) {
          return;
        }
        if (
          status.assurance.details.fheComplete ||
          status.assurance.tier >= 2
        ) {
          clearPendingPoll();
          startTransition(() => {
            if (status.assurance.details.missingProfileSecret) {
              router.refresh();
              return;
            }
            router.replace("/dashboard");
          });
          return;
        }
      } catch {
        // Ignore transient errors and keep polling.
      }

      attemptRef.current++;
      scheduleNextPoll();
    };

    attemptRef.current = 0;
    poll().catch(() => undefined);

    return () => {
      disposed = true;
      clearPendingPoll();
    };
  }, [router]);

  return null;
}
