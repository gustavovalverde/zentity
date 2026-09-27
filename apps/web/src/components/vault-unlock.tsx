"use client";

import type { VaultAccess } from "@/lib/privacy/secrets/vault-access";

import { useAppKit, useAppKitAccount } from "@reown/appkit/react";
import {
  AlertTriangle,
  FileKey,
  Fingerprint,
  KeyRound,
  Lock,
  Wallet,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { useChainId, useSignTypedData } from "wagmi";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { asyncHandler, reportRejection } from "@/lib/async-handler";
import { authClient } from "@/lib/auth/auth-client";
import { parseRecoveryKey } from "@/lib/privacy/credentials/recovery-key";
import { buildKekSignatureTypedData } from "@/lib/privacy/credentials/wallet";
import { hexToBytes } from "@/lib/privacy/primitives/symmetric";
import {
  getStoredProfile,
  getStoredProfileWithCredential,
  type ProfileSecretPayload,
  resetProfileSecretCache,
} from "@/lib/privacy/secrets/profile";
import {
  unlockVaultKey,
  type VaultKey,
  type VaultUnlock,
} from "@/lib/privacy/secrets/vault";
import { trpc } from "@/lib/trpc/client";

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

const WALLET_NONDETERMINISTIC_MESSAGE =
  "wallet_nondeterministic: Wallet signatures are not stable for this message. " +
  "Use passkey/password unlock, or switch wallets and set up backup recovery.";

/**
 * Sign the deterministic KEK-derivation message with the linked wallet.
 * Resolves null when the user first has to connect or switch wallets.
 */
export function useWalletKekSignature(wallet: {
  address: string;
  chainId: number;
}): () => Promise<Uint8Array | null> {
  const { open: openWalletModal } = useAppKit();
  const { address, isConnected } = useAppKitAccount();
  const chainId = useChainId();
  const { mutateAsync: signTypedData } = useSignTypedData();

  return useCallback(async () => {
    if (!(isConnected && address)) {
      openWalletModal().catch(() => undefined);
      return null;
    }

    if (address.toLowerCase() !== wallet.address.toLowerCase()) {
      toast.error(
        `Connect wallet ${wallet.address.slice(0, 6)}...${wallet.address.slice(-4)}`
      );
      openWalletModal().catch(() => undefined);
      return null;
    }

    if (chainId && chainId !== wallet.chainId) {
      toast.error("Switch to the linked wallet network");
      return null;
    }

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
      throw new Error(WALLET_NONDETERMINISTIC_MESSAGE);
    }

    return hexToBytes(signature1);
  }, [isConnected, address, wallet, chainId, signTypedData, openWalletModal]);
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
  const signKekMessage = useWalletKekSignature(wallet);
  const [signing, setSigning] = useState(false);

  const handleClick = useCallback(async () => {
    if (signing || disabled) {
      return;
    }

    setSigning(true);
    try {
      const signatureBytes = await signKekMessage();
      if (!signatureBytes) {
        return;
      }

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
  }, [signing, disabled, signKekMessage, wallet, onSuccess, onError]);

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
    if (hasValidIdentityIntent || intentLoading || intentError) {
      return;
    }
    fetchIdentityIntent().catch(() => undefined);
  }, [
    active,
    vaultState.status,
    hasValidIdentityIntent,
    intentLoading,
    intentError,
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

// ── Vault key unlock (any credential) ──────────────────────

export interface VaultUnlockMethods {
  passkeyCredentialIds: string[];
  password: boolean;
  recoveryKey: boolean;
  wallet: { address: string; chainId: number } | null;
}

export function vaultUnlockMethods(access: VaultAccess): VaultUnlockMethods {
  return {
    passkeyCredentialIds: access.passkeys
      .filter((passkey) => passkey.connected)
      .map((passkey) => passkey.credentialId),
    password: Boolean(access.password?.connected),
    recoveryKey: Boolean(access.recoveryKey),
    wallet: access.wallet?.connected
      ? { address: access.wallet.address, chainId: access.wallet.chainId }
      : null,
  };
}

export function hasVaultUnlockMethod(methods: VaultUnlockMethods): boolean {
  return (
    methods.passkeyCredentialIds.length > 0 ||
    methods.password ||
    methods.recoveryKey ||
    methods.wallet !== null
  );
}

type UnlockOption = "passkey" | "password" | "wallet" | "recovery_key";

function isCancellation(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    (error instanceof DOMException && error.name === "NotAllowedError") ||
    message.includes("NotAllowedError") ||
    message.toLowerCase().includes("user rejected")
  );
}

function WalletUnlockOption({
  wallet,
  busy,
  disabled,
  onUnlock,
}: Readonly<{
  wallet: { address: string; chainId: number };
  busy: boolean;
  disabled: boolean;
  onUnlock: (resolve: () => Promise<VaultUnlock | null>) => void;
}>) {
  const signKekMessage = useWalletKekSignature(wallet);

  return (
    <Button
      className="w-full justify-start gap-3"
      disabled={disabled}
      onClick={() =>
        onUnlock(async () => {
          const signatureBytes = await signKekMessage();
          return signatureBytes
            ? { type: "wallet", ...wallet, signatureBytes }
            : null;
        })
      }
      type="button"
      variant="outline"
    >
      {busy ? <Spinner aria-hidden="true" size="sm" /> : <Wallet />}
      Sign with your wallet
    </Button>
  );
}

/**
 * Lets the user open their vault with any credential that can still unlock
 * it: a passkey, their password, their wallet, or their recovery key.
 */
export function VaultUnlockOptions({
  methods,
  onUnlocked,
  disabled = false,
}: Readonly<{
  methods: VaultUnlockMethods;
  onUnlocked: (vaultKey: VaultKey) => Promise<void> | void;
  disabled?: boolean;
}>) {
  const [busy, setBusy] = useState<UnlockOption | null>(null);
  const [expanded, setExpanded] = useState<"password" | "recovery_key" | null>(
    null
  );
  const [password, setPassword] = useState("");
  const [recoveryWords, setRecoveryWords] = useState("");
  const [error, setError] = useState<string | null>(null);
  const passwordId = useId();
  const recoveryKeyId = useId();

  const run = useCallback(
    async (
      option: UnlockOption,
      resolve: () => Promise<VaultUnlock | null>
    ) => {
      setBusy(option);
      setError(null);
      try {
        const unlock = await resolve();
        if (!unlock) {
          return;
        }
        const vaultKey = await unlockVaultKey(unlock);
        if (!vaultKey) {
          throw new Error("There is no encrypted data to open.");
        }
        await onUnlocked(vaultKey);
      } catch (err) {
        if (!isCancellation(err)) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        setBusy(null);
      }
    },
    [onUnlocked]
  );

  const unlockWithPassword = () =>
    run("password", async () => {
      const result = await authClient.opaque.verifyPassword({ password });
      if (!result.data || result.error) {
        throw new Error("That password is incorrect.");
      }
      return { type: "opaque", exportKey: result.data.exportKey };
    });

  const unlockWithRecoveryKey = () =>
    run("recovery_key", () => {
      const recoveryKey = parseRecoveryKey(recoveryWords);
      if (!recoveryKey) {
        throw new Error(
          "Enter all 24 words of your recovery key, separated by spaces."
        );
      }
      return Promise.resolve({ type: "recovery_key", recoveryKey });
    });

  const isDisabled = disabled || busy !== null;

  return (
    <div className="space-y-3">
      {error ? (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {methods.passkeyCredentialIds.length > 0 && (
        <Button
          className="w-full justify-start gap-3"
          disabled={isDisabled}
          onClick={() => {
            run("passkey", () =>
              Promise.resolve({
                type: "passkey_prompt",
                credentialIds: methods.passkeyCredentialIds,
              })
            ).catch(reportRejection);
          }}
          type="button"
          variant="outline"
        >
          {busy === "passkey" ? (
            <Spinner aria-hidden="true" size="sm" />
          ) : (
            <Fingerprint />
          )}
          Use a passkey
        </Button>
      )}

      {methods.wallet && (
        <WalletUnlockOption
          busy={busy === "wallet"}
          disabled={isDisabled}
          onUnlock={(resolve) => {
            run("wallet", resolve).catch(reportRejection);
          }}
          wallet={methods.wallet}
        />
      )}

      {methods.password &&
        (expanded === "password" ? (
          <form
            className="space-y-2"
            onSubmit={(event) => {
              event.preventDefault();
              unlockWithPassword().catch(reportRejection);
            }}
          >
            <Label htmlFor={passwordId}>Password</Label>
            <div className="flex gap-2">
              <Input
                autoComplete="current-password"
                autoFocus
                disabled={isDisabled}
                id={passwordId}
                onChange={(event) => setPassword(event.target.value)}
                type="password"
                value={password}
              />
              <Button
                disabled={isDisabled || !password}
                type="submit"
                variant="outline"
              >
                {busy === "password" ? (
                  <Spinner aria-hidden="true" size="sm" />
                ) : null}
                Unlock
              </Button>
            </div>
          </form>
        ) : (
          <Button
            className="w-full justify-start gap-3"
            disabled={isDisabled}
            onClick={() => setExpanded("password")}
            type="button"
            variant="outline"
          >
            <KeyRound />
            Use your password
          </Button>
        ))}

      {methods.recoveryKey &&
        (expanded === "recovery_key" ? (
          <form
            className="space-y-2"
            onSubmit={(event) => {
              event.preventDefault();
              unlockWithRecoveryKey().catch(reportRejection);
            }}
          >
            <Label htmlFor={recoveryKeyId}>Recovery key</Label>
            <Textarea
              autoCapitalize="none"
              autoComplete="off"
              autoFocus
              disabled={isDisabled}
              id={recoveryKeyId}
              onChange={(event) => setRecoveryWords(event.target.value)}
              placeholder="Enter the 24 words, separated by spaces"
              rows={4}
              spellCheck={false}
              value={recoveryWords}
            />
            <Button
              className="w-full"
              disabled={isDisabled || !recoveryWords.trim()}
              type="submit"
              variant="outline"
            >
              {busy === "recovery_key" ? (
                <Spinner aria-hidden="true" size="sm" />
              ) : null}
              Unlock with recovery key
            </Button>
          </form>
        ) : (
          <Button
            className="w-full justify-start gap-3"
            disabled={isDisabled}
            onClick={() => setExpanded("recovery_key")}
            type="button"
            variant="outline"
          >
            <FileKey />
            Use your recovery key
          </Button>
        ))}
    </div>
  );
}

/**
 * Ask the user to open their vault. Prompts for a passkey directly when that
 * is the only way in; otherwise shows every available option in a dialog.
 * Resolves null when the user has no vault or closes the dialog.
 */
export type VaultKeyRequest =
  | { status: "no_vault" }
  | { status: "cancelled" }
  | { status: "unlocked"; vaultKey: VaultKey };

export function useVaultKeyPrompt(): {
  dialog: React.ReactNode;
  requestVaultKey: () => Promise<VaultKeyRequest>;
} {
  const [methods, setMethods] = useState<VaultUnlockMethods | null>(null);
  const resolverRef = useRef<((request: VaultKeyRequest) => void) | null>(null);

  const settle = useCallback((vaultKey: VaultKey | null) => {
    resolverRef.current?.(
      vaultKey ? { status: "unlocked", vaultKey } : { status: "cancelled" }
    );
    resolverRef.current = null;
    setMethods(null);
  }, []);

  const requestVaultKey = useCallback(async (): Promise<VaultKeyRequest> => {
    const access = await trpc.secrets.access.query();
    if (!access) {
      return { status: "no_vault" };
    }
    const available = vaultUnlockMethods(access);
    const onlyPasskeys =
      available.passkeyCredentialIds.length > 0 &&
      !(available.password || available.wallet || available.recoveryKey);
    if (onlyPasskeys) {
      try {
        const vaultKey = await unlockVaultKey({
          type: "passkey_prompt",
          credentialIds: available.passkeyCredentialIds,
        });
        return vaultKey
          ? { status: "unlocked", vaultKey }
          : { status: "no_vault" };
      } catch (error) {
        if (isCancellation(error)) {
          return { status: "cancelled" };
        }
        throw error;
      }
    }
    return new Promise<VaultKeyRequest>((resolve) => {
      resolverRef.current = resolve;
      setMethods(available);
    });
  }, []);

  const dialog = (
    <Dialog
      onOpenChange={(open) => {
        if (!open) {
          settle(null);
        }
      }}
      open={methods !== null}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Open your encrypted data</DialogTitle>
          <DialogDescription>
            Confirm it's you with one of the ways you can open your encryption
            keys and verified profile.
          </DialogDescription>
        </DialogHeader>
        {methods ? (
          <VaultUnlockOptions methods={methods} onUnlocked={settle} />
        ) : null}
      </DialogContent>
    </Dialog>
  );

  return { dialog, requestVaultKey };
}
