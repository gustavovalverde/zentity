"use client";

import { ChevronDown, Fingerprint, Info, KeyRound, Wallet } from "lucide-react";
import { useId } from "react";

import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils/classname";

export type CredentialType = "passkey" | "password" | "wallet";

interface CredentialChoiceProps {
  onSelect: (type: CredentialType) => void;
  prfSupported: boolean;
  disabled?: boolean;
  activeType?: CredentialType | null;
  processingType?: CredentialType | null;
}

/**
 * Credential choice component for sign-up.
 *
 * Each card IS the action trigger:
 * - Passkey: fires browser passkey dialog immediately
 * - Wallet: opens wallet modal immediately
 * - Password: expands inline form below
 *
 * Order follows primacy effect: Passkey (recommended) is positioned first.
 */
export function CredentialChoice({
  onSelect,
  prfSupported,
  disabled = false,
  activeType = null,
  processingType = null,
}: Readonly<CredentialChoiceProps>) {
  const collapsibleId = useId();
  const isProcessing = !!processingType;

  const cardClass = (type: CredentialType, typeDisabled = false) => {
    const isActive = activeType === type;
    const isCardDisabled = disabled || typeDisabled || isProcessing;

    return cn(
      "group relative flex flex-col items-center gap-3 rounded-lg border p-4 text-center transition-all",
      isActive && "border-primary bg-primary/5 ring-2 ring-primary/20",
      !(isActive || isCardDisabled) &&
        "hover:border-primary hover:bg-accent/50 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20",
      isCardDisabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"
    );
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {/* Passkey Option - First position (primacy effect) */}
        <button
          className={cardClass("passkey", !prfSupported)}
          disabled={disabled || !prfSupported || isProcessing}
          onClick={() => onSelect("passkey")}
          type="button"
        >
          <Badge
            className="absolute -top-2 left-1/2 -translate-x-1/2 text-xs"
            variant="secondary"
          >
            Recommended
          </Badge>
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
            {processingType === "passkey" ? (
              <Spinner className="h-5 w-5 text-primary" />
            ) : (
              <Fingerprint className="h-5 w-5 text-primary" />
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <span className="font-medium">Passkey</span>
            <Tooltip>
              <TooltipTrigger asChild>
                {/* biome-ignore lint/a11y/useSemanticElements: span with role=button avoids nested buttons */}
                <span
                  className="cursor-help text-muted-foreground hover:text-foreground"
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                  role="button"
                  tabIndex={0}
                >
                  <Info className="h-3.5 w-3.5" />
                </span>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs" side="top">
                <p className="font-medium">WebAuthn with PRF Extension</p>
                <p className="mt-1 text-muted">
                  Your biometric (fingerprint/face) is used to unlock key
                  material locally. We only store encrypted data and will ask
                  you to secure verification data later during onboarding.
                </p>
              </TooltipContent>
            </Tooltip>
          </div>
          <p className="mt-auto text-muted-foreground text-sm">
            {processingType === "passkey"
              ? "Creating passkey…"
              : "Use fingerprint or face"}
          </p>
          {!prfSupported && (
            <p className="text-destructive text-xs">
              Not supported on this device
            </p>
          )}
        </button>

        {/* Password Option - Middle position (familiar fallback) */}
        <button
          className={cardClass("password")}
          disabled={disabled || isProcessing}
          onClick={() => onSelect("password")}
          type="button"
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted">
            {processingType === "password" ? (
              <Spinner className="h-5 w-5 text-muted-foreground" />
            ) : (
              <KeyRound className="h-5 w-5 text-muted-foreground" />
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <span className="font-medium">Password</span>
            <Tooltip>
              <TooltipTrigger asChild>
                {/* biome-ignore lint/a11y/useSemanticElements: span with role=button avoids nested buttons */}
                <span
                  className="cursor-help text-muted-foreground hover:text-foreground"
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                  role="button"
                  tabIndex={0}
                >
                  <Info className="h-3.5 w-3.5" />
                </span>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs" side="top">
                <p className="font-medium">OPAQUE Protocol</p>
                <p className="mt-1 text-muted">
                  Your password is never sent to the server, not even in
                  encrypted form. OPAQUE proves you know the password without
                  revealing it and can secure verification data later.
                </p>
              </TooltipContent>
            </Tooltip>
          </div>
          <p className="mt-auto text-muted-foreground text-sm">
            {processingType === "password"
              ? "Creating account…"
              : "Use a secure password"}
          </p>
        </button>

        {/* Wallet Option - Last position (specialized audience) */}
        <button
          className={cardClass("wallet")}
          disabled={disabled || isProcessing}
          onClick={() => onSelect("wallet")}
          type="button"
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted">
            {processingType === "wallet" ? (
              <Spinner className="h-5 w-5 text-muted-foreground" />
            ) : (
              <Wallet className="h-5 w-5 text-muted-foreground" />
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <span className="font-medium">Wallet</span>
            <Tooltip>
              <TooltipTrigger asChild>
                {/* biome-ignore lint/a11y/useSemanticElements: span with role=button avoids nested buttons */}
                <span
                  className="cursor-help text-muted-foreground hover:text-foreground"
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                  role="button"
                  tabIndex={0}
                >
                  <Info className="h-3.5 w-3.5" />
                </span>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs" side="top">
                <p className="font-medium">EIP-712 Signature</p>
                <p className="mt-1 text-muted">
                  Your wallet can sign a structured message to secure your
                  verification data. The signature stays in your browser and the
                  server never sees it.
                </p>
              </TooltipContent>
            </Tooltip>
          </div>
          <p className="mt-auto text-muted-foreground text-sm">
            {processingType === "wallet"
              ? "Connecting…"
              : "Use your crypto wallet"}
          </p>
        </button>
      </div>

      {/* Security Explainer */}
      <Collapsible id={collapsibleId}>
        <CollapsibleTrigger className="flex w-full items-center justify-center gap-2 rounded-lg py-2 text-muted-foreground text-sm hover:text-foreground">
          <span>How your data stays private</span>
          <ChevronDown className="h-4 w-4 transition-transform [[data-state=open]>&]:rotate-180" />
        </CollapsibleTrigger>
        <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
          <div className="space-y-3 rounded-lg border bg-muted/30 p-4 text-sm">
            <p className="text-muted-foreground">
              Your data is encrypted with a key that only you can access. We
              store the encrypted version, so even if our servers were
              compromised your data would be useless without your passkey,
              password, or wallet.
            </p>
            <p className="text-muted-foreground text-xs">
              Tap the{" "}
              <Info className="inline-block h-3 w-3 align-text-bottom" /> icon
              on each option to learn how it protects your keys.
            </p>
          </div>
        </CollapsibleContent>
      </Collapsible>

      <p className="text-center text-muted-foreground text-xs">
        You can add additional methods later in Settings.
      </p>
    </div>
  );
}
