"use client";

import { Check, KeyRound, ShieldCheck } from "lucide-react";
import { memo, useMemo } from "react";

import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils/utils";

/**
 * Status values for the account creation flow.
 * Each status represents a distinct phase in the passkey/password setup.
 */
export type SecureStatus =
  | "idle"
  | "registering-passkey"
  | "unlocking-prf"
  | "generating-keys"
  | "encrypting-keys"
  | "uploading-keys"
  | "registering-keys"
  | "creating-account"
  | "finalizing-identity"
  | "generating-proofs"
  | "storing-proofs"
  | "complete"
  | "error";

/**
 * Get a user-friendly message for the current status.
 */
export function getStatusMessage(status: SecureStatus): string | null {
  switch (status) {
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
    case "registering-keys":
      return "Registering keys with the FHE service…";
    case "creating-account":
      return "Creating your account and storing secrets…";
    case "finalizing-identity":
      return "Finalizing your identity data…";
    case "generating-proofs":
      return "Generating privacy proofs…";
    case "storing-proofs":
      return "Storing proofs securely…";
    default:
      return null;
  }
}

type StepStatus = "pending" | "active" | "complete";

function StepIndicatorIcon({
  status,
  icon,
}: {
  status: StepStatus;
  icon: React.ReactNode;
}) {
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
}: {
  label: string;
  status: StepStatus;
  icon: React.ReactNode;
}) {
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
  /** Whether identity documents were uploaded (shows extra steps) */
  hasIdentityDocs: boolean;
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
  hasIdentityDocs,
}: VerificationProgressProps) {
  const progressStatus = useMemo(() => {
    const steps: SecureStatus[] = [
      "registering-passkey",
      "unlocking-prf",
      "generating-keys",
      "encrypting-keys",
      "uploading-keys",
      "registering-keys",
      "creating-account",
      "finalizing-identity",
      "generating-proofs",
      "storing-proofs",
      "complete",
    ];
    const currentIndex = steps.indexOf(status);

    const stepStatus = (
      index: number,
      active: SecureStatus | SecureStatus[]
    ): StepStatus => {
      const activeSteps = Array.isArray(active) ? active : [active];
      if (currentIndex > index) {
        return "complete";
      }
      if (activeSteps.includes(status)) {
        return "active";
      }
      return "pending";
    };

    return {
      passkey: stepStatus(0, "registering-passkey"),
      prf: stepStatus(1, "unlocking-prf"),
      secure: stepStatus(5, [
        "generating-keys",
        "encrypting-keys",
        "uploading-keys",
        "registering-keys",
      ]),
      account: stepStatus(6, "creating-account"),
      verify: stepStatus(7, "finalizing-identity"),
      proofs: stepStatus(8, "generating-proofs"),
      store: stepStatus(9, "storing-proofs"),
    };
  }, [status]);

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
        <StepIndicator
          icon={<KeyRound className="h-4 w-4" />}
          label="Create passkey"
          status={progressStatus.passkey}
        />
        <StepIndicator
          icon={<Spinner />}
          label="Derive encryption key"
          status={progressStatus.prf}
        />
        <StepIndicator
          icon={<ShieldCheck className="h-4 w-4" />}
          label="Secure FHE keys"
          status={progressStatus.secure}
        />
        <StepIndicator
          icon={<ShieldCheck className="h-4 w-4" />}
          label="Create account & store keys"
          status={progressStatus.account}
        />
        {hasIdentityDocs ? (
          <>
            <StepIndicator
              icon={<ShieldCheck className="h-4 w-4" />}
              label="Finalize identity"
              status={progressStatus.verify}
            />
            <StepIndicator
              icon={<ShieldCheck className="h-4 w-4" />}
              label="Generate privacy proofs"
              status={progressStatus.proofs}
            />
            <StepIndicator
              icon={<ShieldCheck className="h-4 w-4" />}
              label="Store proofs"
              status={progressStatus.store}
            />
          </>
        ) : null}
      </div>
    </div>
  );
});
