"use client";

import { useAppKit, useAppKitAccount } from "@reown/appkit/react";
import { AlertTriangle, KeyRound, Lock, Wallet } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useChainId, useSignTypedData } from "wagmi";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { asyncHandler, reportRejection } from "@/lib/async-handler";
import { authClient } from "@/lib/auth/auth-client";
import {
  buildKekSignatureTypedData,
  signatureToBytes,
} from "@/lib/privacy/credentials/wallet";
import {
  getStoredProfile,
  getStoredProfileWithCredential,
  type ProfileSecretPayload,
  resetProfileSecretCache,
} from "@/lib/privacy/secrets/profile";

// ── Types ──────────────────────────────────────────────────

type VaultErrorCategory =
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
    title: "No identity data found in your vault.",
    remedy:
      "If you've already verified, your data may not have been saved. Re-verify from your dashboard to enable identity sharing.",
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

// ── Error alert + credential-specific unlock controls ──────

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
      onClick={asyncHandler(handleClick)}
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
            handleSubmit().catch(reportRejection);
          }
        }}
        placeholder="Enter your password"
        type="password"
        value={password}
      />
      <Button
        disabled={verifying || disabled || !password.trim()}
        onClick={asyncHandler(handleSubmit)}
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

// ── Hook ───────────────────────────────────────────────────

export interface IdentityIntentState {
  expiresAt: number;
  scopeKey: string;
  token: string;
}

interface UseVaultUnlockOptions {
  active: boolean;
  fetchIntentToken: () => Promise<{
    intent_token: string;
    expires_at: number;
  }>;
  logTag: string;
  scopeKey: string;
}

export interface UseVaultUnlockReturn {
  clearIntent: () => void;
  fetchIdentityIntent: () => Promise<void>;
  handleProfileLoaded: (profile: ProfileSecretPayload) => void;
  handleVaultError: (err: unknown) => void;
  hasValidIdentityIntent: boolean;
  identityIntent: IdentityIntentState | null;
  intentError: string | null;
  intentLoading: boolean;
  loadProfilePasskey: () => Promise<void>;
  profileRef: React.RefObject<ProfileSecretPayload | null>;
  resetToGesture: () => void;
  vaultState: VaultState;
}

const INTENT_EXPIRY_GRACE_MS = 2000;

export async function fetchIntentFromEndpoint(
  url: string,
  body: Record<string, unknown>
): Promise<{ intent_token: string; expires_at: number }> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = (await response.json().catch(() => null)) as {
    intent_token?: string;
    expires_at?: number;
    error?: string;
  } | null;

  if (!response.ok) {
    throw new Error(data?.error || "Unable to prepare identity consent.");
  }

  if (
    !data ||
    typeof data.intent_token !== "string" ||
    typeof data.expires_at !== "number"
  ) {
    throw new Error("Identity consent token response was invalid.");
  }

  return { intent_token: data.intent_token, expires_at: data.expires_at };
}

export function useVaultUnlock({
  logTag,
  scopeKey,
  active,
  fetchIntentToken,
}: UseVaultUnlockOptions): UseVaultUnlockReturn {
  const [vaultState, setVaultState] = useState<VaultState>({ status: "idle" });
  const profileRef = useRef<ProfileSecretPayload | null>(null);
  const [identityIntent, setIdentityIntent] =
    useState<IdentityIntentState | null>(null);
  const [intentLoading, setIntentLoading] = useState(false);
  const [intentError, setIntentError] = useState<string | null>(null);

  const hasValidIdentityIntent = useMemo(() => {
    if (!identityIntent) {
      return false;
    }
    if (identityIntent.scopeKey !== scopeKey) {
      return false;
    }
    return (
      identityIntent.expiresAt * 1000 > Date.now() + INTENT_EXPIRY_GRACE_MS
    );
  }, [identityIntent, scopeKey]);

  const handleProfileLoaded = useCallback((profile: ProfileSecretPayload) => {
    profileRef.current = profile;
    setIntentError(null);
    setIdentityIntent(null);
    setVaultState({ status: "loaded" });
  }, []);

  const handleVaultError = useCallback(
    (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      let name: string = typeof err;
      if (err instanceof DOMException) {
        name = `DOMException.${err.name}`;
      } else if (err instanceof Error) {
        name = err.constructor.name;
      }
      console.error(`[${logTag}] Vault unlock failed (${name}): ${msg}`);
      profileRef.current = null;
      setIdentityIntent(null);
      setIntentError(null);
      setVaultState({ status: "error", error: classifyVaultError(err) });
    },
    [logTag]
  );

  const loadProfilePasskey = useCallback(async () => {
    setVaultState({ status: "loading" });
    try {
      const profile = await getStoredProfile();
      if (profile) {
        handleProfileLoaded(profile);
      } else {
        profileRef.current = null;
        const { title, remedy } = VAULT_ERRORS.not_enrolled;
        setVaultState({
          status: "not_enrolled",
          error: { category: "not_enrolled", title, remedy },
        });
      }
    } catch (err) {
      handleVaultError(err);
    }
  }, [handleProfileLoaded, handleVaultError]);

  const fetchIdentityIntent = useCallback(async () => {
    setIntentLoading(true);
    setIntentError(null);
    try {
      const result = await fetchIntentToken();
      setIdentityIntent({
        token: result.intent_token,
        expiresAt: result.expires_at,
        scopeKey,
      });
    } catch (err) {
      setIdentityIntent(null);
      setIntentError(
        err instanceof Error
          ? err.message
          : "Unable to prepare identity consent."
      );
    } finally {
      setIntentLoading(false);
    }
  }, [fetchIntentToken, scopeKey]);

  const resetToGesture = useCallback(() => {
    setVaultState({ status: "gesture_required" });
  }, []);

  const clearIntent = useCallback(() => {
    setIdentityIntent(null);
  }, []);

  useEffect(() => {
    if (!active) {
      profileRef.current = null;
      setIdentityIntent(null);
      setIntentError(null);
      setIntentLoading(false);
      setVaultState({ status: "idle" });
      return;
    }

    resetProfileSecretCache();
    profileRef.current = null;
    setIdentityIntent(null);
    setIntentError(null);
    setIntentLoading(false);
    setVaultState({ status: "gesture_required" });
  }, [active]);

  useEffect(() => {
    if (!active || vaultState.status !== "loaded") {
      return;
    }
    if (hasValidIdentityIntent || intentLoading) {
      return;
    }
    fetchIdentityIntent().catch(() => undefined);
  }, [
    active,
    vaultState.status,
    hasValidIdentityIntent,
    intentLoading,
    fetchIdentityIntent,
  ]);

  return {
    vaultState,
    profileRef,
    identityIntent,
    intentLoading,
    intentError,
    hasValidIdentityIntent,
    handleProfileLoaded,
    handleVaultError,
    loadProfilePasskey,
    fetchIdentityIntent,
    resetToGesture,
    clearIntent,
  };
}

// ── Panel ──────────────────────────────────────────────────

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
        Unlocking your vault…
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
              onClick={() => {
                fetchIdentityIntent().catch(reportRejection);
              }}
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
          <p>Use your passkey to share your information.</p>
          <Button
            onClick={asyncHandler(loadProfilePasskey)}
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
          <p>Enter your password to share your information.</p>
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
          <p>Sign with your wallet to share your information.</p>
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
