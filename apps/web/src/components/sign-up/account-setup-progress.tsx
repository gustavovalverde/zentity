"use client";

import type { CredentialType } from "./credential-choice";

import { Check, KeyRound, ShieldCheck } from "lucide-react";
import { memo, useMemo } from "react";

import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils/classname";

/**
 * Status values for the account creation flow.
 * Each status represents a distinct phase in the passkey/password setup.
 */
export type SecureStatus =
  | "idle"
  | "preparing-account"
  | "registering-passkey"
  | "unlocking-prf"
  | "generating-keys"
  | "encrypting-keys"
  | "uploading-keys"
  | "storing-secrets"
  | "complete"
  | "error";

/**
 * Get a user-friendly message for the current status.
 */
function getStatusMessage(status: SecureStatus): string | null {
  switch (status) {
    case "preparing-account":
      return "Preparing your account…";
    case "registering-passkey":
      return "Creating your passkey…";
    case "unlocking-prf":
      return "Deriving encryption keys from your passkey…";
    case "generating-keys":
      return "Generating FHE keys locally…";
    case "encrypting-keys":
      return "Encrypting FHE keys on-device…";
    case "uploading-keys":
      return "Uploading encrypted keys…";
    case "storing-secrets":
      return "Storing encrypted secrets…";
    default:
      return null;
  }
}

type StepStatus = "pending" | "active" | "complete";

function StepIndicatorIcon({
  status,
  icon,
}: Readonly<{
  status: StepStatus;
  icon: React.ReactNode;
}>) {
  if (status === "complete") {
    return <Check className="h-4 w-4" />;
  }
  if (status === "active") {
    return <Spinner />;
  }
  return icon;
}

function StepIndicator({
  label,
  status,
  icon,
}: Readonly<{
  label: string;
  status: StepStatus;
  icon: React.ReactNode;
}>) {
  return (
    <div className="flex items-center gap-3">
      <div
        className={cn(
          "flex h-8 w-8 items-center justify-center rounded-full transition-all",
          status === "complete" && "bg-success text-success-foreground",
          status === "active" && "animate-pulse bg-info text-info-foreground",
          status === "pending" && "bg-muted text-muted-foreground"
        )}
      >
        <StepIndicatorIcon icon={icon} status={status} />
      </div>
      <span
        className={cn(
          "text-sm transition-colors",
          status === "complete" && "font-medium text-success",
          status === "active" && "font-medium text-info",
          status === "pending" && "text-muted-foreground"
        )}
      >
        {label}
      </span>
    </div>
  );
}

interface VerificationProgressProps {
  /** Current status of the verification process */
  status: SecureStatus;
  credentialType: CredentialType | null;
}

/**
 * Displays progress indicators for the account creation flow.
 *
 * Shows a series of steps with visual feedback for:
 * - Passkey creation
 * - Key derivation
 * - FHE key securing
 * - Account creation
 * - Identity finalization (if documents uploaded)
 * - Proof generation (if documents uploaded)
 *
 * Memoized to prevent re-renders when parent state changes but props remain the same.
 * (rerender-memo optimization)
 */
export const VerificationProgress = memo(function VerificationProgress({
  status,
  credentialType,
}: Readonly<VerificationProgressProps>) {
  const progressStatus = useMemo(() => {
    const STATUS_ORDER: Record<SecureStatus, number> = {
      idle: -1,
      "preparing-account": 0,
      "registering-passkey": 1,
      "unlocking-prf": 2,
      "generating-keys": 3,
      "encrypting-keys": 4,
      "uploading-keys": 5,
      "storing-secrets": 6,
      complete: 7,
      error: -1,
    };

    const current = STATUS_ORDER[status];

    const stepStatus = (params: {
      start: SecureStatus;
      end: SecureStatus;
      active: SecureStatus | SecureStatus[];
    }): StepStatus => {
      const activeSteps = Array.isArray(params.active)
        ? params.active
        : [params.active];
      if (activeSteps.includes(status)) {
        return "active";
      }
      if (current > STATUS_ORDER[params.end]) {
        return "complete";
      }
      if (current >= STATUS_ORDER[params.start]) {
        return "pending";
      }
      return "pending";
    };

    return {
      passkey: stepStatus({
        start: "preparing-account",
        end: "unlocking-prf",
        active: ["preparing-account", "registering-passkey", "unlocking-prf"],
      }),
      secure: stepStatus({
        start: "generating-keys",
        end: "uploading-keys",
        active: ["generating-keys", "encrypting-keys", "uploading-keys"],
      }),
      secrets: stepStatus({
        start: "storing-secrets",
        end: "storing-secrets",
        active: "storing-secrets",
      }),
      shouldShowPasskey: credentialType === "passkey",
    };
  }, [credentialType, status]);

  const statusMessage = getStatusMessage(status);

  // Don't render if idle or error
  if (status === "idle" || status === "error") {
    return null;
  }

  return (
    <div className="fade-in animate-in space-y-4 rounded-lg border border-info/30 bg-info/10 p-5 text-info duration-300">
      <div className="mb-4 flex items-center gap-2">
        <ShieldCheck className="h-5 w-5" />
        <span className="font-medium">Creating your secure account</span>
      </div>

      {statusMessage ? (
        <p className="text-info/80 text-sm">{statusMessage}</p>
      ) : null}

      <div className="space-y-3">
        {progressStatus.shouldShowPasskey ? (
          <StepIndicator
            icon={<KeyRound className="h-4 w-4" />}
            label="Create passkey & derive keys"
            status={progressStatus.passkey}
          />
        ) : null}
        <StepIndicator
          icon={<ShieldCheck className="h-4 w-4" />}
          label="Secure FHE keys"
          status={progressStatus.secure}
        />
        <StepIndicator
          icon={<ShieldCheck className="h-4 w-4" />}
          label="Store encrypted secrets"
          status={progressStatus.secrets}
        />
      </div>
    </div>
  );
});
