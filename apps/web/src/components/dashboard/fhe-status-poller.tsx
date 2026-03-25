"use client";

import { AlertCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { startTransition, useEffect, useRef, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc/client";

const MAX_POLL_ATTEMPTS = 60;

/**
 * Poll for FHE completion after proofs are already stored.
 * Refreshes the current route once the assurance profile reports completion.
 * Stops after MAX_POLL_ATTEMPTS and shows a timeout error.
 */
export function FheStatusPoller() {
  const router = useRouter();
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptRef = useRef(0);
  const [error, setError] = useState<"timeout" | "network" | null>(null);

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
      if (attemptRef.current >= MAX_POLL_ATTEMPTS) {
        setError("timeout");
        return;
      }

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
        if (!disposed) {
          setError("network");
          return;
        }
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

  const handleRetry = () => {
    attemptRef.current = 0;
    setError(null);
    // Re-trigger the effect by refreshing the page
    router.refresh();
  };

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
          <span>
            {error === "timeout"
              ? "Encryption is taking longer than expected. Try refreshing the page."
              : "Network error while checking encryption status."}
          </span>
          <Button onClick={handleRetry} size="sm" variant="outline">
            Retry
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  return null;
}
