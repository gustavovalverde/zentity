"use client";

import type { UseVaultUnlockReturn } from "@/components/vault-unlock/use-vault-unlock";

import { Lock } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  OpaqueVaultUnlockForm,
  VaultErrorAlert,
  WalletVaultUnlockButton,
} from "@/components/vault-unlock/vault-unlock";

interface VaultUnlockPanelProps {
  active: boolean;
  authMode: "passkey" | "opaque" | "wallet" | null;
  disabled: boolean;
  vault: UseVaultUnlockReturn;
  wallet: { address: string; chainId: number } | null;
}

export function VaultUnlockPanel({
  active,
  authMode,
  disabled,
  vault,
  wallet,
}: Readonly<VaultUnlockPanelProps>) {
  if (!active) {
    return null;
  }

  const {
    vaultState,
    intentError,
    intentLoading,
    hasValidIdentityIntent,
    handleProfileLoaded,
    handleVaultError,
    loadProfilePasskey,
    fetchIdentityIntent,
    resetToGesture,
  } = vault;

  if (vaultState.status === "loading") {
    return (
      <div className="flex items-center gap-2 text-muted-foreground text-sm">
        <Spinner aria-hidden="true" size="sm" />
        Unlocking your identity vault…
      </div>
    );
  }

  if (vaultState.status === "loaded") {
    if (intentError) {
      return (
        <Alert variant="destructive">
          <AlertDescription className="space-y-2">
            <p>{intentError}</p>
            <Button
              disabled={disabled || intentLoading}
              onClick={() => fetchIdentityIntent().catch(() => undefined)}
              size="sm"
              type="button"
              variant="outline"
            >
              Retry secure consent
            </Button>
          </AlertDescription>
        </Alert>
      );
    }

    if (intentLoading || !hasValidIdentityIntent) {
      return (
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Spinner aria-hidden="true" size="sm" />
          Preparing secure consent…
        </div>
      );
    }

    return null;
  }

  if (vaultState.status === "not_enrolled" || vaultState.status === "error") {
    return (
      <VaultErrorAlert
        error={vaultState.error}
        onRetry={
          authMode === "passkey" || !authMode
            ? loadProfilePasskey
            : resetToGesture
        }
      />
    );
  }

  if (vaultState.status !== "gesture_required") {
    return null;
  }

  if (authMode === "passkey" || !authMode) {
    return (
      <Alert>
        <Lock className="size-4" />
        <AlertDescription className="space-y-2">
          <p>Unlock your identity vault to share personal information.</p>
          <Button
            onClick={loadProfilePasskey}
            size="sm"
            type="button"
            variant="outline"
          >
            Unlock vault
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  if (authMode === "opaque") {
    return (
      <Alert>
        <Lock className="size-4" />
        <AlertDescription className="space-y-2">
          <p>Enter your password to unlock your identity vault.</p>
          <OpaqueVaultUnlockForm
            disabled={disabled}
            onError={handleVaultError}
            onSuccess={handleProfileLoaded}
          />
        </AlertDescription>
      </Alert>
    );
  }

  if (authMode === "wallet" && wallet) {
    return (
      <Alert>
        <Lock className="size-4" />
        <AlertDescription className="space-y-2">
          <p>Sign with your wallet to unlock your identity vault.</p>
          <WalletVaultUnlockButton
            disabled={disabled}
            onError={handleVaultError}
            onSuccess={handleProfileLoaded}
            wallet={wallet}
          />
        </AlertDescription>
      </Alert>
    );
  }

  return null;
}
