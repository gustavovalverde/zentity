"use client";

import { AlertTriangle, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

interface FheErrorBannerProps {
  fheKeyId: string;
}

/**
 * Non-blocking warning banner shown when FHE encryption failed.
 * Users can retry encryption or continue verification — the error
 * doesn't block document/liveness steps.
 */
export function FheErrorBanner({ fheKeyId }: Readonly<FheErrorBannerProps>) {
  const router = useRouter();
  const [isRetrying, setIsRetrying] = useState(false);

  const handleRetry = useCallback(async () => {
    setIsRetrying(true);
    try {
      const response = await fetch("/api/identity/fhe-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fheKeyId,
          fheStatus: "pending",
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to reset encryption status");
      }

      toast.success("Encryption will retry automatically");
      router.refresh();
    } catch {
      toast.error("Could not reset encryption status");
    } finally {
      setIsRetrying(false);
    }
  }, [fheKeyId, router]);

  return (
    <Alert variant="warning">
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>Encryption needs attention</AlertTitle>
      <AlertDescription className="flex items-center justify-between gap-4">
        <span>
          Background encryption encountered an issue. This will retry
          automatically during your next verification step.
        </span>
        <Button
          disabled={isRetrying}
          onClick={() => handleRetry().catch(() => undefined)}
          size="sm"
          variant="outline"
        >
          {isRetrying ? (
            <Spinner className="mr-1.5" size="sm" />
          ) : (
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
          )}
          Retry
        </Button>
      </AlertDescription>
    </Alert>
  );
}
