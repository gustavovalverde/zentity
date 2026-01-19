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
      <div className="text-center">
        <h2 className="font-semibold text-lg">
          How would you like to sign in?
        </h2>
        <p className="mt-1 text-muted-foreground text-sm">
          Choose your preferred authentication method
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {/* Passkey Option - First position (primacy effect) */}
        <button
          className={cn(
            "group relative flex flex-col items-center gap-2 rounded-lg border p-4 text-center transition-all",
            prfSupported && !disabled
              ? "cursor-pointer hover:border-primary hover:bg-accent/50 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              : "cursor-not-allowed opacity-60"
          )}
          disabled={disabled || !prfSupported}
          onClick={() => prfSupported && onSelect("passkey")}
          type="button"
        >
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
          <Badge variant="secondary">Recommended</Badge>
          <p className="text-muted-foreground text-sm">
            Sign in with fingerprint or face
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
            "group relative flex flex-col items-center gap-2 rounded-lg border p-4 text-center transition-all",
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
          <p className="text-muted-foreground text-sm">
            Create a secure password
          </p>
        </button>

        {/* Wallet Option - Last position (specialized audience) */}
        <button
          className={cn(
            "group relative flex flex-col items-center gap-2 rounded-lg border p-4 text-center transition-all",
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
          <div className="flex items-center gap-1.5">
            <span className="font-medium">Web3 Wallet</span>
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
          <p className="text-muted-foreground text-sm">
            Sign in with your crypto wallet
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
          <div className="space-y-4 rounded-lg border bg-muted/30 p-4 text-sm">
            <div>
              <p className="font-medium">End-to-end encryption you control</p>
              <p className="mt-1 text-muted-foreground">
                Your sensitive data is encrypted with a random key before it
                reaches our servers. That key is then wrapped using your chosen
                authentication method. We only store the wrapped version.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1">
                <p className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
                  With Passkey
                </p>
                <p className="text-muted-foreground text-xs">
                  Your biometric generates a unique cryptographic output that
                  wraps the key. Only your specific passkey can unwrap it.
                </p>
              </div>
              <div className="space-y-1">
                <p className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
                  With Password
                </p>
                <p className="text-muted-foreground text-xs">
                  OPAQUE derives a secret from your password without ever
                  sending it. That secret wraps your encryption key.
                </p>
              </div>
              <div className="space-y-1">
                <p className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
                  With Wallet
                </p>
                <p className="text-muted-foreground text-xs">
                  Your wallet signature derives a key that wraps your encryption
                  key. Only your wallet can recreate it.
                </p>
              </div>
            </div>

            <p className="border-t pt-3 text-muted-foreground text-xs">
              <strong className="text-foreground">The result:</strong> Even if
              our servers were compromised, your encrypted data would be
              useless. Only you can decrypt it.
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
