"use client";

/**
 * UI for face match results during dashboard verification.
 */
import type { FaceMatchResult } from "@/lib/identity/liveness/face-match";

import { ArrowLeftRight, Check, UserCheck, XCircle } from "lucide-react";
import Image from "next/image";
import { memo } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils/classname";

type FaceMatchStatus = "idle" | "matching" | "matched" | "no_match" | "error";

interface FaceVerificationCardProps {
  /** Current status of face matching */
  status: FaceMatchStatus;
  /** Result from face matching, if available */
  result: FaceMatchResult | null;
  /** Selfie image (best frame or captured image) */
  selfieImage: string | null;
}

/**
 * Displays face verification progress and results.
 *
 * Shows side-by-side comparison of ID photo face and selfie
 * with visual feedback for matching status (loading, matched, no match, error).
 *
 * Memoized to prevent re-renders when parent state changes but props remain the same.
 * (rerender-memo optimization)
 */
export const FaceVerificationCard = memo(function FaceVerificationCard({
  status,
  result,
  selfieImage,
}: Readonly<FaceVerificationCardProps>) {
  return (
    <div className="space-y-4 rounded-lg border p-4">
      <div className="flex items-center gap-2">
        <UserCheck className="h-5 w-5 text-muted-foreground" />
        <span className="font-medium">Face Verification</span>
      </div>

      <div className="flex items-center justify-center gap-4">
        {/* ID Face */}
        <div className="flex flex-col items-center gap-2">
          <div
            className={cn(
              "relative h-20 w-20 overflow-hidden rounded-lg border bg-muted",
              status === "matching" && "ring-2 ring-info/40 ring-offset-2"
            )}
          >
            {status === "matching" && !result?.idFaceImage ? (
              <Skeleton className="h-full w-full" />
            ) : null}
            {result?.idFaceImage ? (
              <Image
                alt="Face extracted from your ID (preview)"
                className={cn(
                  "h-full w-full object-cover transition-opacity duration-300",
                  status === "matching" && "opacity-70"
                )}
                height={80}
                src={result.idFaceImage}
                unoptimized
                width={80}
              />
            ) : null}
            {!result?.idFaceImage && status !== "matching" ? (
              <div className="flex h-full w-full items-center justify-center text-muted-foreground text-xs">
                ID face
              </div>
            ) : null}
          </div>
          <span className="text-muted-foreground text-xs">ID Photo</span>
        </div>

        {/* Status Indicator */}
        <div className="flex flex-col items-center gap-1">
          {status === "idle" ? (
            <ArrowLeftRight className="h-6 w-6 text-muted-foreground" />
          ) : null}

          {status === "matching" ? (
            <div className="fade-in flex animate-in flex-col items-center gap-1 duration-300">
              <div className="relative">
                <Spinner className="size-6 text-info" />
                <div className="absolute inset-0 h-6 w-6 animate-ping rounded-full bg-info/20" />
              </div>
              <Skeleton className="mt-1 h-3 w-16" />
            </div>
          ) : null}

          {status === "matched" ? (
            <div className="zoom-in animate-in duration-300">
              <Check className="h-6 w-6 text-success" />
              <span className="font-medium text-success text-xs">
                {Math.round((result?.confidence || 0) * 100)}% match
              </span>
            </div>
          ) : null}

          {status === "no_match" ? (
            <>
              <XCircle className="h-6 w-6 text-destructive" />
              <span className="font-medium text-destructive text-xs">
                No match
              </span>
            </>
          ) : null}

          {status === "error" ? (
            <>
              <XCircle className="h-6 w-6 text-destructive" />
              <span className="font-medium text-destructive text-xs">
                Error
              </span>
            </>
          ) : null}
        </div>

        {/* Selfie */}
        <div className="flex flex-col items-center gap-2">
          <div
            className={cn(
              "relative h-20 w-20 overflow-hidden rounded-lg border bg-muted",
              status === "matching" && "ring-2 ring-info/40 ring-offset-2"
            )}
          >
            {status === "matching" && !selfieImage ? (
              <Skeleton className="h-full w-full" />
            ) : null}
            {selfieImage ? (
              <Image
                alt="Selfie"
                className={cn(
                  "h-full w-full object-cover transition-opacity duration-300",
                  status === "matching" && "opacity-70"
                )}
                height={80}
                src={selfieImage}
                unoptimized
                width={80}
              />
            ) : null}
          </div>
          <span className="text-muted-foreground text-xs">Selfie</span>
        </div>
      </div>

      {/* Status Messages */}
      {status === "matching" ? (
        <p className="text-center text-muted-foreground text-sm">
          Comparing faces…
        </p>
      ) : null}

      {status === "matched" ? (
        <Alert variant="success">
          <Check className="h-4 w-4" />
          <AlertDescription className="ml-2">
            Face verification successful. The selfie matches the ID document.
          </AlertDescription>
        </Alert>
      ) : null}

      {status === "no_match" ? (
        <Alert variant="destructive">
          <XCircle className="h-4 w-4" />
          <AlertDescription className="ml-2">
            The selfie does not match the ID document photo. You may proceed,
            but additional verification may be required.
          </AlertDescription>
        </Alert>
      ) : null}

      {status === "error" ? (
        <Alert>
          <AlertDescription>
            Face verification could not be completed. You may proceed, but
            please ensure your ID and selfie are clear.
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
});
