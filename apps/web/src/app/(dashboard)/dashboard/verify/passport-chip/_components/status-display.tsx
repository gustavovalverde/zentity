"use client";

import { AlertTriangle, Clock, Loader2, Scan, ShieldCheck } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export type FlowStage =
  | "connecting"
  | "scanning"
  | "generating"
  | "verifying"
  | "finalizing"
  | "success"
  | "error"
  | "timeout";

interface StatusDisplayProps {
  errorMessage?: string | null;
  onNavigate?: () => void;
  onRetry?: () => void;
  proofsGenerated?: number;
  proofsTotal?: number;
  stage: FlowStage;
}

export function StatusDisplay({
  stage,
  errorMessage,
  proofsGenerated = 0,
  proofsTotal = 0,
  onRetry,
  onNavigate,
}: Readonly<StatusDisplayProps>) {
  if (stage === "connecting") {
    return (
      <Alert>
        <Loader2 className="h-4 w-4 animate-spin" />
        <AlertTitle>Waiting for connection</AlertTitle>
        <AlertDescription>
          Scan the QR code below with the ZKPassport app, or tap the button if
          you&apos;re on your phone.
        </AlertDescription>
      </Alert>
    );
  }

  if (stage === "scanning") {
    return (
      <Alert>
        <Loader2 className="h-4 w-4 animate-spin" />
        <AlertTitle>Phone connected</AlertTitle>
        <AlertDescription>
          Reading your document&apos;s NFC chip. Hold your document against the
          back of your phone.
        </AlertDescription>
      </Alert>
    );
  }

  if (stage === "generating") {
    return (
      <Alert>
        <Loader2 className="h-4 w-4 animate-spin" />
        <AlertTitle>Generating zero-knowledge proofs</AlertTitle>
        <AlertDescription>
          Your phone is generating cryptographic proofs. This may take a moment.
          {proofsTotal > 0 && (
            <span className="mt-1 block font-medium">
              Progress: {proofsGenerated}/{proofsTotal} proofs generated
            </span>
          )}
        </AlertDescription>
      </Alert>
    );
  }

  if (stage === "verifying") {
    return (
      <Alert>
        <Loader2 className="h-4 w-4 animate-spin" />
        <AlertTitle>Verifying results</AlertTitle>
        <AlertDescription>
          Processing your verification results...
        </AlertDescription>
      </Alert>
    );
  }

  if (stage === "finalizing") {
    return (
      <Alert>
        <Scan className="h-4 w-4 animate-pulse" />
        <AlertTitle>Document verified. Finalizing encryption...</AlertTitle>
        <AlertDescription>
          Your document has been cryptographically verified. FHE encryption is
          being finalized in the background. This page will update
          automatically.
        </AlertDescription>
      </Alert>
    );
  }

  if (stage === "success") {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-green-600 dark:text-green-400">
            <ShieldCheck className="h-5 w-5" />
            Document Verified
          </CardTitle>
          <CardDescription>
            Your document&apos;s NFC chip has been cryptographically verified.
            You&apos;ve reached the Chip Verified tier — the highest level of
            identity assurance.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button className="w-full" onClick={onNavigate} size="lg">
            Go to Dashboard
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (stage === "timeout") {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-yellow-600 dark:text-yellow-400">
            <Clock className="h-5 w-5" />
            Connection Timed Out
          </CardTitle>
          <CardDescription>
            No response within 5 minutes. Make sure the ZKPassport app is
            installed and your phone is connected to the internet.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button className="w-full" onClick={onRetry} variant="outline">
            Try Again
          </Button>
        </CardContent>
      </Card>
    );
  }

  // Error state
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-destructive">
          <AlertTriangle className="h-5 w-5" />
          Verification Failed
        </CardTitle>
        <CardDescription>
          {errorMessage ?? "An unexpected error occurred during verification."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button className="w-full" onClick={onRetry} variant="outline">
          Try Again
        </Button>
      </CardContent>
    </Card>
  );
}
