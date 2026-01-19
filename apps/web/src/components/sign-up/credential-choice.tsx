"use client";

import { ChevronDown, Fingerprint, Info, KeyRound, Wallet } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
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
}

/**
 * Credential choice component for sign-up.
 * Allows users to choose between passkey, password, or wallet authentication.
 *
 * Order follows primacy effect: users naturally choose the first/leftmost option,
 * so Passkey (recommended) is positioned first.
 */
export function CredentialChoice({
  onSelect,
  prfSupported,
  disabled = false,
}: Readonly<CredentialChoiceProps>) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {/* Passkey Option - First position (primacy effect) */}
        <button
          className={cn(
            "group relative flex flex-col items-center gap-3 rounded-lg border p-4 text-center transition-all",
            prfSupported && !disabled
              ? "cursor-pointer border-primary/50 hover:border-primary hover:bg-accent/50 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              : "cursor-not-allowed opacity-60"
          )}
          disabled={disabled || !prfSupported}
          onClick={() => prfSupported && onSelect("passkey")}
          type="button"
        >
          {/* Corner badge - positioned outside content flow */}
          <Badge
            className="absolute -top-2 left-1/2 -translate-x-1/2 text-xs"
            variant="secondary"
          >
            Recommended
          </Badge>
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
            <Fingerprint className="h-5 w-5 text-primary" />
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
                  Your biometric (fingerprint/face) derives encryption keys
                  locally. The biometric never leaves your device; only a
                  cryptographic proof is used.
                </p>
              </TooltipContent>
            </Tooltip>
          </div>
          <p className="mt-auto text-muted-foreground text-sm">
            Use fingerprint or face
          </p>
          {!prfSupported && (
            <p className="text-destructive text-xs">
              Not supported on this device
            </p>
          )}
        </button>

        {/* Password Option - Middle position (familiar fallback) */}
        <button
          className={cn(
            "group relative flex flex-col items-center gap-3 rounded-lg border p-4 text-center transition-all",
            disabled
              ? "cursor-not-allowed opacity-60"
              : "cursor-pointer hover:border-primary hover:bg-accent/50 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          )}
          disabled={disabled}
          onClick={() => onSelect("password")}
          type="button"
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted">
            <KeyRound className="h-5 w-5 text-muted-foreground" />
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
                  revealing it and derives encryption keys locally.
                </p>
              </TooltipContent>
            </Tooltip>
          </div>
          <p className="mt-auto text-muted-foreground text-sm">
            Use a secure password
          </p>
        </button>

        {/* Wallet Option - Last position (specialized audience) */}
        <button
          className={cn(
            "group relative flex flex-col items-center gap-3 rounded-lg border p-4 text-center transition-all",
            disabled
              ? "cursor-not-allowed opacity-60"
              : "cursor-pointer hover:border-primary hover:bg-accent/50 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          )}
          disabled={disabled}
          onClick={() => onSelect("wallet")}
          type="button"
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted">
            <Wallet className="h-5 w-5 text-muted-foreground" />
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
                  Your wallet signs a structured message that derives encryption
                  keys. The signature stays in your browser and the server never
                  sees it.
                </p>
              </TooltipContent>
            </Tooltip>
          </div>
          <p className="mt-auto text-muted-foreground text-sm">
            Use your crypto wallet
          </p>
        </button>
      </div>

      {/* Security Explainer */}
      <Collapsible>
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
