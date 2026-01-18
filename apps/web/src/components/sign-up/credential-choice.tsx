"use client";

import { Fingerprint, KeyRound } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils/classname";

export type CredentialType = "passkey" | "password";

interface CredentialChoiceProps {
  onSelect: (type: CredentialType) => void;
  prfSupported: boolean;
  disabled?: boolean;
}

/**
 * Credential choice component for sign-up.
 * Allows users to choose between passkey or password authentication.
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

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {/* Passkey Option */}
        <button
          className={cn(
            "group relative flex flex-col items-start gap-3 rounded-lg border p-4 text-left transition-all",
            prfSupported && !disabled
              ? "cursor-pointer hover:border-primary hover:bg-accent/50 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              : "cursor-not-allowed opacity-60"
          )}
          disabled={disabled || !prfSupported}
          onClick={() => prfSupported && onSelect("passkey")}
          type="button"
        >
          <div className="flex items-center gap-2">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
              <Fingerprint className="h-5 w-5 text-primary" />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">Passkey</span>
              <Badge variant="secondary">Recommended</Badge>
            </div>
          </div>

          <p className="text-muted-foreground text-sm">
            Secure sign-in using your device&apos;s biometrics or security key.
            No password to remember.
          </p>

          {!prfSupported && (
            <p className="text-destructive text-sm">
              Not supported on this device or browser
            </p>
          )}
        </button>

        {/* Password Option */}
        <button
          className={cn(
            "group relative flex flex-col items-start gap-3 rounded-lg border p-4 text-left transition-all",
            disabled
              ? "cursor-not-allowed opacity-60"
              : "cursor-pointer hover:border-primary hover:bg-accent/50 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          )}
          disabled={disabled}
          onClick={() => onSelect("password")}
          type="button"
        >
          <div className="flex items-center gap-2">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted">
              <KeyRound className="h-5 w-5 text-muted-foreground" />
            </div>
            <span className="font-medium">Password</span>
          </div>

          <p className="text-muted-foreground text-sm">
            Traditional email and password authentication. You&apos;ll create a
            secure password.
          </p>
        </button>
      </div>

      <p className="text-center text-muted-foreground text-sm">
        You can add the other method later in Settings.
      </p>
    </div>
  );
}
