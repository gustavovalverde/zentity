"use client";

import { useAppKit, useAppKitAccount } from "@reown/appkit/react";
import { AlertTriangle, KeyRound, Lock, Wallet } from "lucide-react";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { useChainId, useSignTypedData } from "wagmi";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { authClient } from "@/lib/auth/auth-client";
import {
  buildKekSignatureTypedData,
  signatureToBytes,
} from "@/lib/privacy/credentials";
import {
  getStoredProfileWithCredential,
  type ProfileSecretPayload,
} from "@/lib/privacy/secrets/profile";

// ── Types ──────────────────────────────────────────────────

export type VaultErrorCategory =
  | "not_enrolled"
  | "browser_unsupported"
  | "cancelled"
  | "session_expired"
  | "wallet_needed"
  | "wallet_nondeterministic"
  | "unknown";

export interface VaultError {
  category: VaultErrorCategory;
  remedy: string;
  title: string;
}

export type VaultState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "loaded" }
  | { status: "gesture_required" }
  | { status: "not_enrolled"; error: VaultError }
  | { status: "error"; error: VaultError };

export const VAULT_ERRORS: Record<
  VaultErrorCategory,
  { title: string; remedy: string }
> = {
  not_enrolled: {
    title: "Your identity vault hasn't been set up yet.",
    remedy: "Complete identity verification on your Zentity dashboard first.",
  },
  browser_unsupported: {
    title: "Your browser doesn't support secure vault unlock.",
    remedy:
      "Try Chrome, Edge, or Safari, which support passkey-based vault access.",
  },
  cancelled: {
    title: "Passkey prompt was dismissed.",
    remedy: "",
  },
  session_expired: {
    title: "Your session key has expired.",
    remedy: "Sign in again to unlock your vault.",
  },
  wallet_needed: {
    title: "Wallet signature needed to unlock your vault.",
    remedy: "Connect your wallet and approve the access request.",
  },
  wallet_nondeterministic: {
    title: "This wallet does not produce deterministic signatures.",
    remedy:
      "Use a passkey/password unlock method, or switch wallets and set up backup recovery.",
  },
  unknown: {
    title: "Unable to unlock your identity vault.",
    remedy: "",
  },
};

// ── Helpers ────────────────────────────────────────────────

export function classifyVaultError(error: unknown): VaultError {
  const msg = error instanceof Error ? error.message : String(error);
  const domName = error instanceof DOMException ? error.name : "";

  let category: VaultErrorCategory = "unknown";

  if (
    domName === "NotAllowedError" ||
    msg.includes("NotAllowedError") ||
    msg.includes("user gesture")
  ) {
    category = "cancelled";
  } else if (
    domName === "SecurityError" ||
    msg.includes("PRF output") ||
    msg.includes("WebAuthn authentication is unavailable") ||
    msg.includes("WebAuthn is not available") ||
    msg.includes("PRF extension not supported")
  ) {
    category = "browser_unsupported";
  } else if (
    msg.includes("session key has expired") ||
    msg.includes("sign in again")
  ) {
    category = "session_expired";
  } else if (
    msg.includes("wallet_nondeterministic") ||
    msg.includes("deterministic signatures") ||
    msg.includes("RFC 6979")
  ) {
    category = "wallet_nondeterministic";
  } else if (msg.includes("sign the key access request with your wallet")) {
    category = "wallet_needed";
  }

  const { title, remedy } = VAULT_ERRORS[category];
  return { category, title, remedy };
}

export function buildIdentityPayload(profile: ProfileSecretPayload) {
  const fullName =
    profile.fullName?.trim() ||
    [profile.firstName, profile.lastName].filter(Boolean).join(" ").trim();

  const address =
    profile.residentialAddress || profile.addressCountryCode
      ? {
          formatted: profile.residentialAddress ?? undefined,
          country: profile.addressCountryCode ?? undefined,
        }
      : undefined;

  const nationality = profile.nationalityCode || profile.nationality;

  return {
    given_name: profile.firstName ?? undefined,
    family_name: profile.lastName ?? undefined,
    name: fullName || undefined,
    birthdate: profile.dateOfBirth ?? undefined,
    address,
    document_number: profile.documentNumber ?? undefined,
    document_type: profile.documentType ?? undefined,
    issuing_country: profile.documentOrigin ?? undefined,
    nationality: nationality ?? undefined,
    nationalities: nationality ? [nationality] : undefined,
  };
}

export function buildScopeKey(scopes: string[]): string {
  return [...new Set(scopes.map((scope) => scope.trim()).filter(Boolean))]
    .sort()
    .join(" ");
}

// ── Components ─────────────────────────────────────────────

const RETRYABLE_CATEGORIES = new Set<VaultErrorCategory>([
  "cancelled",
  "wallet_needed",
  "unknown",
]);

export function VaultErrorAlert({
  error,
  onRetry,
}: {
  error: VaultError;
  onRetry: () => void;
}) {
  const Icon =
    error.category === "cancelled" ||
    error.category === "wallet_needed" ||
    error.category === "unknown"
      ? Lock
      : AlertTriangle;

  return (
    <Alert>
      <Icon className="size-4" />
      <AlertDescription className="space-y-2">
        <p>
          {error.title}
          {error.remedy ? ` ${error.remedy}` : ""}
        </p>
        {RETRYABLE_CATEGORIES.has(error.category) && (
          <Button onClick={onRetry} size="sm" type="button" variant="outline">
            Retry
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}

export function WalletVaultUnlockButton({
  wallet,
  onSuccess,
  onError,
  disabled,
}: Readonly<{
  wallet: { address: string; chainId: number };
  onSuccess: (profile: ProfileSecretPayload) => void;
  onError: (error: unknown) => void;
  disabled: boolean;
}>) {
  const { open: openWalletModal } = useAppKit();
  const { address, isConnected } = useAppKitAccount();
  const chainId = useChainId();
  const { mutateAsync: signTypedData } = useSignTypedData();
  const [signing, setSigning] = useState(false);

  const handleClick = useCallback(async () => {
    if (signing || disabled) {
      return;
    }

    if (!(isConnected && address)) {
      openWalletModal().catch(() => undefined);
      return;
    }

    if (address.toLowerCase() !== wallet.address.toLowerCase()) {
      toast.error(
        `Connect wallet ${wallet.address.slice(0, 6)}...${wallet.address.slice(-4)}`
      );
      openWalletModal().catch(() => undefined);
      return;
    }

    if (chainId && chainId !== wallet.chainId) {
      toast.error("Switch to the linked wallet network");
      return;
    }

    setSigning(true);
    try {
      const session = await authClient.getSession();
      const userId = session.data?.user?.id;
      if (!userId) {
        throw new Error("Session expired. Please sign in again.");
      }

      const typedData = buildKekSignatureTypedData({
        userId,
        chainId: wallet.chainId,
      });

      const signArgs = {
        domain: typedData.domain as Record<string, unknown>,
        types: typedData.types as Record<
          string,
          Array<{ name: string; type: string }>
        >,
        primaryType: typedData.primaryType,
        message: typedData.message as Record<string, unknown>,
      };

      const signature1 = await signTypedData(signArgs);
      const signature2 = await signTypedData(signArgs);

      if (signature1 !== signature2) {
        throw new Error(
          "wallet_nondeterministic: Wallet signatures are not stable for this message. " +
            "Use passkey/password unlock, or switch wallets and set up backup recovery."
        );
      }

      const signatureBytes = signatureToBytes(signature1);

      const profile = await getStoredProfileWithCredential({
        type: "wallet",
        address: wallet.address,
        chainId: wallet.chainId,
        signatureBytes,
      });

      if (!profile) {
        throw new Error(
          "No profile data found. Complete identity verification first."
        );
      }

      onSuccess(profile);
    } catch (error) {
      onError(error);
    } finally {
      setSigning(false);
    }
  }, [
    signing,
    disabled,
    isConnected,
    address,
    wallet,
    chainId,
    signTypedData,
    openWalletModal,
    onSuccess,
    onError,
  ]);

  return (
    <Button
      disabled={signing || disabled}
      onClick={handleClick}
      size="sm"
      type="button"
      variant="outline"
    >
      {signing ? (
        <Spinner aria-hidden="true" className="mr-2" size="sm" />
      ) : (
        <Wallet className="mr-2 size-3" />
      )}
      {signing ? "Signing..." : "Sign with Wallet"}
    </Button>
  );
}

export function OpaqueVaultUnlockForm({
  onSuccess,
  onError,
  disabled,
}: Readonly<{
  onSuccess: (profile: ProfileSecretPayload) => void;
  onError: (error: unknown) => void;
  disabled: boolean;
}>) {
  const [password, setPassword] = useState("");
  const [verifying, setVerifying] = useState(false);

  const handleSubmit = useCallback(async () => {
    if (!password.trim() || verifying || disabled) {
      return;
    }

    setVerifying(true);
    try {
      const result = await authClient.opaque.verifyPassword({ password });
      if (!result.data || result.error) {
        throw new Error(
          result.error?.message || "Password verification failed."
        );
      }

      const profile = await getStoredProfileWithCredential({
        type: "opaque",
        exportKey: result.data.exportKey,
      });

      if (!profile) {
        throw new Error(
          "No profile data found. Complete identity verification first."
        );
      }

      onSuccess(profile);
    } catch (error) {
      onError(error);
    } finally {
      setVerifying(false);
    }
  }, [password, verifying, disabled, onSuccess, onError]);

  return (
    <div className="flex items-center gap-2">
      <Input
        className="h-8 text-sm"
        disabled={verifying || disabled}
        onChange={(e) => setPassword(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            handleSubmit();
          }
        }}
        placeholder="Enter your password"
        type="password"
        value={password}
      />
      <Button
        disabled={verifying || disabled || !password.trim()}
        onClick={handleSubmit}
        size="sm"
        type="button"
        variant="outline"
      >
        {verifying ? (
          <Spinner aria-hidden="true" className="mr-2" size="sm" />
        ) : (
          <KeyRound className="mr-2 size-3" />
        )}
        {verifying ? "Verifying..." : "Unlock"}
      </Button>
    </div>
  );
}
