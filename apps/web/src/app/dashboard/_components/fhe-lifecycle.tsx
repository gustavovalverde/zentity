"use client";

import { useQueryClient } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import { AlertCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { startTransition, useEffect, useRef } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { reportRejection } from "@/lib/async-handler";
import { startBackgroundKeygen } from "@/lib/privacy/fhe/background-keygen";
import { type RouterOutputs, trpcReact } from "@/lib/trpc/client";

// Mounts a side effect that kicks off FHE key generation in the background
// on dashboard load when the user has not yet enrolled. Renders nothing.
export function FheBackgroundKeygen({
  hasEnrollment,
}: Readonly<{ hasEnrollment: boolean }>) {
  useEffect(() => {
    if (!hasEnrollment) {
      startBackgroundKeygen();
    }
  }, [hasEnrollment]);

  return null;
}

const MAX_POLL_ATTEMPTS = 60;

function hasTerminalAssurance(status: RouterOutputs["assurance"]["profile"]) {
  return status.assurance.details.fheComplete || status.assurance.tier >= 2;
}

// Polls assurance.profile until FHE attributes are encrypted, then navigates
// back to the dashboard. Used on verify landing after proofs are stored.
export function FheStatusPoller() {
  const router = useRouter();
  const utils = trpcReact.useUtils();
  const queryClient = useQueryClient();
  const handledTerminalRef = useRef(false);
  const profileQuery = trpcReact.assurance.profile.useQuery(undefined, {
    refetchInterval: (query) => {
      if (query.state.status === "error") {
        return false;
      }
      const status = query.state.data;
      if (status && hasTerminalAssurance(status)) {
        return false;
      }
      if (query.state.dataUpdateCount >= MAX_POLL_ATTEMPTS) {
        return false;
      }
      return Math.min(2000 * 1.5 ** query.state.dataUpdateCount, 8000);
    },
    refetchIntervalInBackground: true,
    retry: false,
  });

  useEffect(() => {
    utils.assurance.profile.reset().catch(reportRejection);
  }, [utils]);

  useEffect(() => {
    const status = profileQuery.data;
    if (
      !status ||
      handledTerminalRef.current ||
      !hasTerminalAssurance(status)
    ) {
      return;
    }

    handledTerminalRef.current = true;
    startTransition(() => {
      if (status.assurance.details.missingProfileSecret) {
        router.refresh();
        return;
      }
      router.replace("/dashboard");
    });
  }, [profileQuery.data, router]);

  const profileQueryState = queryClient.getQueryState(
    getQueryKey(trpcReact.assurance.profile, undefined, "query")
  );
  const profileDataUpdateCount = profileQueryState?.dataUpdateCount ?? 0;
  const isTerminal = Boolean(
    profileQuery.data && hasTerminalAssurance(profileQuery.data)
  );
  const hasTimedOut = Boolean(
    profileQuery.data &&
      !isTerminal &&
      profileDataUpdateCount >= MAX_POLL_ATTEMPTS
  );
  let error: "network" | "timeout" | null = null;
  if (profileQuery.status === "error") {
    error = "network";
  } else if (hasTimedOut) {
    error = "timeout";
  }

  const handleRetry = () => {
    handledTerminalRef.current = false;
    utils.assurance.profile.reset().catch(reportRejection);
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
