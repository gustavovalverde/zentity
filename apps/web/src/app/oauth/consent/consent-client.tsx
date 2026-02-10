"use client";

import { useAppKit, useAppKitAccount } from "@reown/appkit/react";
import {
  AlertTriangle,
  ExternalLink,
  KeyRound,
  Lock,
  Wallet,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useChainId, useSignTypedData } from "wagmi";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { authClient } from "@/lib/auth/auth-client";
import { getSignedOAuthQuery } from "@/lib/auth/oauth-post-login";
import { isIdentityScope } from "@/lib/auth/oidc/identity-scopes";
import {
  groupScopes,
  HIDDEN_SCOPES,
  SCOPE_DESCRIPTIONS,
} from "@/lib/auth/oidc/scope-display";
import {
  buildKekSignatureTypedData,
  signatureToBytes,
} from "@/lib/privacy/credentials";
import {
  getStoredProfile,
  getStoredProfileWithCredential,
  type ProfileSecretPayload,
  resetProfileSecretCache,
} from "@/lib/privacy/secrets/profile";

interface ClientMeta {
  name: string;
  icon: string | null;
  uri: string | null;
}

interface IdentityIntentState {
  token: string;
  expiresAt: number;
  scopeKey: string;
}

const INTENT_EXPIRY_GRACE_MS = 2000;

function buildIdentityPayload(profile: ProfileSecretPayload) {
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

function isHttpsUrl(url: string): boolean {
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

function buildScopeKey(scopes: string[]): string {
  return [...new Set(scopes.map((scope) => scope.trim()).filter(Boolean))]
    .sort()
    .join(" ");
}

function ClientAvatar({ meta }: { meta: ClientMeta | null }) {
  const safeIcon = meta?.icon && isHttpsUrl(meta.icon) ? meta.icon : null;

  if (safeIcon && meta) {
    return (
      // biome-ignore lint/performance/noImgElement: external client icon URL, not a static asset
      // biome-ignore lint/correctness/useImageSize: dimensions set via CSS size-12
      <img
        alt={meta.name}
        className="size-12 rounded-full border border-border object-cover"
        src={safeIcon}
      />
    );
  }

  const letter = (meta?.name ?? "?")[0].toUpperCase();
  return (
    <div className="flex size-12 items-center justify-center rounded-full bg-muted font-semibold text-lg text-muted-foreground">
      {letter}
    </div>
  );
}

type VaultErrorCategory =
  | "not_enrolled"
  | "browser_unsupported"
  | "cancelled"
  | "session_expired"
  | "wallet_needed"
  | "wallet_nondeterministic"
  | "unknown";

interface VaultError {
  category: VaultErrorCategory;
  title: string;
  remedy: string;
}

type VaultState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "loaded" }
  | { status: "gesture_required" }
  | { status: "not_enrolled"; error: VaultError }
  | { status: "error"; error: VaultError };

const VAULT_ERRORS: Record<
  VaultErrorCategory,
  { title: string; remedy: string }
> = {
  not_enrolled: {
    title: "Your identity vault hasn't been set up yet.",
    remedy: "Complete identity verification on your Zentity dashboard first.",
  },
  browser_unsupported: {
    title: "Your browser doesn't support secure vault unlock.",
    remedy: "Try Chrome or Edge, which support passkey-based vault access.",
  },
  cancelled: {
    title: "Passkey prompt was dismissed.",
    remedy: "",
  },
  session_expired: {
    title: "Your session key has expired.",
    remedy: "Sign in again with your password to unlock your vault.",
  },
  wallet_needed: {
    title: "Wallet signature needed to unlock your vault.",
    remedy: "Connect your wallet and approve the access request.",
  },
  wallet_nondeterministic: {
    title: "This wallet does not produce deterministic signatures.",
    remedy:
      "Use a passkey/password unlock method, or switch to a wallet that supports RFC 6979.",
  },
  unknown: {
    title: "Unable to unlock your identity vault.",
    remedy: "",
  },
};

function classifyVaultError(error: unknown): VaultError {
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

const RETRYABLE_CATEGORIES = new Set<VaultErrorCategory>([
  "cancelled",
  "wallet_needed",
  "unknown",
]);

function VaultErrorAlert({
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

// --- Wallet vault unlock button ---

function WalletVaultUnlockButton({
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
          "wallet_nondeterministic: Wallet does not produce deterministic signatures. " +
            "Encryption requires a wallet that implements RFC 6979."
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

// --- OPAQUE vault unlock form ---

function OpaqueVaultUnlockForm({
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

// --- Main consent component ---

export function OAuthConsentClient({
  clientId,
  clientMeta,
  optionalScopes,
  scopeParam,
  authMode,
  wallet,
}: Readonly<{
  clientId: string | null;
  clientMeta: ClientMeta | null;
  optionalScopes: string[];
  scopeParam: string;
  authMode: "passkey" | "opaque" | "wallet" | null;
  wallet: { address: string; chainId: number } | null;
}>) {
  const rawClientName = clientMeta?.name ?? clientId ?? "Unknown app";
  const clientName =
    rawClientName.length > 100
      ? `${rawClientName.slice(0, 97)}...`
      : rawClientName;
  const [isPopup, setIsPopup] = useState(false);

  useEffect(() => {
    setIsPopup(!!globalThis.window.opener);
  }, []);

  const allScopes = useMemo(
    () => [
      ...new Set(
        scopeParam
          .split(" ")
          .map((s) => s.trim())
          .filter(Boolean)
      ),
    ],
    [scopeParam]
  );

  const optionalSet = useMemo(() => new Set(optionalScopes), [optionalScopes]);

  const visible = useMemo(
    () => allScopes.filter((s) => !HIDDEN_SCOPES.has(s)),
    [allScopes]
  );

  const required = useMemo(
    () => visible.filter((s) => !optionalSet.has(s)),
    [visible, optionalSet]
  );

  const optional = useMemo(
    () => visible.filter((s) => optionalSet.has(s)),
    [visible, optionalSet]
  );

  const requiredGroups = useMemo(() => groupScopes(required), [required]);
  const optionalGroups = useMemo(() => groupScopes(optional), [optional]);

  const [selectedOptional, setSelectedOptional] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const approvedScopes = useMemo(
    () => [
      ...allScopes.filter((s) => HIDDEN_SCOPES.has(s)),
      ...required,
      ...selectedOptional,
    ],
    [allScopes, required, selectedOptional]
  );

  // --- Profile unlock for identity scopes ---
  const [vaultState, setVaultState] = useState<VaultState>({ status: "idle" });
  const profileRef = useRef<ProfileSecretPayload | null>(null);
  const [identityIntent, setIdentityIntent] =
    useState<IdentityIntentState | null>(null);
  const [intentLoading, setIntentLoading] = useState(false);
  const [intentError, setIntentError] = useState<string | null>(null);

  const hasApprovedIdentityScopes = useMemo(
    () => approvedScopes.some(isIdentityScope),
    [approvedScopes]
  );
  const approvedScopeKey = useMemo(
    () => buildScopeKey(approvedScopes),
    [approvedScopes]
  );
  const hasValidIdentityIntent = useMemo(() => {
    if (!identityIntent) {
      return false;
    }
    if (identityIntent.scopeKey !== approvedScopeKey) {
      return false;
    }
    return (
      identityIntent.expiresAt * 1000 > Date.now() + INTENT_EXPIRY_GRACE_MS
    );
  }, [identityIntent, approvedScopeKey]);

  const handleProfileLoaded = useCallback((profile: ProfileSecretPayload) => {
    profileRef.current = profile;
    setIntentError(null);
    setIdentityIntent(null);
    setVaultState({ status: "loaded" });
  }, []);

  const handleVaultError = useCallback((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    let name: string = typeof err;
    if (err instanceof DOMException) {
      name = `DOMException.${err.name}`;
    } else if (err instanceof Error) {
      name = err.constructor.name;
    }
    console.error(`[consent] Vault unlock failed (${name}): ${msg}`);
    profileRef.current = null;
    setIdentityIntent(null);
    setIntentError(null);
    setVaultState({ status: "error", error: classifyVaultError(err) });
  }, []);

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
    const oauthQuery = getSignedOAuthQuery();
    if (!oauthQuery) {
      throw new Error("Missing OAuth context for identity consent.");
    }

    setIntentLoading(true);
    setIntentError(null);
    try {
      const response = await fetch("/api/oauth2/identity/intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          oauth_query: oauthQuery,
          scopes: approvedScopes,
        }),
      });

      const body = (await response.json().catch(() => null)) as {
        intent_token?: string;
        expires_at?: number;
        error?: string;
      } | null;

      if (!response.ok) {
        throw new Error(body?.error || "Unable to prepare identity consent.");
      }

      if (
        !body ||
        typeof body.intent_token !== "string" ||
        typeof body.expires_at !== "number"
      ) {
        throw new Error("Identity consent token response was invalid.");
      }

      setIdentityIntent({
        token: body.intent_token,
        expiresAt: body.expires_at,
        scopeKey: approvedScopeKey,
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
  }, [approvedScopeKey, approvedScopes]);

  useEffect(() => {
    if (!hasApprovedIdentityScopes) {
      profileRef.current = null;
      setIdentityIntent(null);
      setIntentError(null);
      setIntentLoading(false);
      setVaultState({ status: "idle" });
      return;
    }

    // Always require a fresh user gesture for identity-scope consent.
    resetProfileSecretCache();
    profileRef.current = null;
    setIdentityIntent(null);
    setIntentError(null);
    setIntentLoading(false);
    setVaultState({ status: "gesture_required" });
  }, [hasApprovedIdentityScopes]);

  useEffect(() => {
    if (!hasApprovedIdentityScopes || vaultState.status !== "loaded") {
      return;
    }
    if (hasValidIdentityIntent || intentLoading) {
      return;
    }
    fetchIdentityIntent().catch(() => undefined);
  }, [
    fetchIdentityIntent,
    hasApprovedIdentityScopes,
    hasValidIdentityIntent,
    intentLoading,
    vaultState.status,
  ]);

  const toggleOptional = (scope: string) => {
    setSelectedOptional((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope]
    );
  };

  const captureIdentityIfNeeded = async (): Promise<void> => {
    if (!hasApprovedIdentityScopes) {
      return;
    }

    const oauthQuery = getSignedOAuthQuery();
    if (!oauthQuery) {
      throw new Error("Missing OAuth context for identity sharing.");
    }

    const profile = profileRef.current;
    if (!profile) {
      throw new Error("Unlock your identity vault before allowing access.");
    }

    if (!(identityIntent && hasValidIdentityIntent)) {
      throw new Error(
        "Secure identity consent expired. Unlock your vault and try again."
      );
    }

    const identityPayload = buildIdentityPayload(profile);

    const response = await fetch("/api/oauth2/identity/stage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        oauth_query: oauthQuery,
        scopes: approvedScopes,
        identity: identityPayload,
        intent_token: identityIntent.token,
      }),
    });

    const body = (await response.json().catch(() => null)) as {
      staged?: boolean;
      error?: string;
    } | null;

    if (!response.ok) {
      setIdentityIntent(null);
      throw new Error(body?.error || "Unable to stage identity claims.");
    }
    if (!body?.staged) {
      setIdentityIntent(null);
      throw new Error("Identity claims were not staged.");
    }

    setIdentityIntent(null);
  };

  const handleConsent = async (accept: boolean) => {
    setIsSubmitting(true);
    setError(null);

    try {
      if (accept && hasApprovedIdentityScopes) {
        if (vaultState.status !== "loaded") {
          throw new Error("Unlock your identity vault before allowing access.");
        }
        if (!hasValidIdentityIntent) {
          throw new Error(
            "Secure identity consent expired. Unlock your vault and try again."
          );
        }

        // Stage identity claims in the ephemeral store BEFORE creating the
        // consent record. The server's customIdTokenClaims hook will consume
        // them during token exchange. Identity scopes are never persisted in
        // the consent DB — the ephemeral store is the sole authority.
        await captureIdentityIfNeeded();
      }

      // Only persist non-identity scopes in the consent record.
      // Identity claims are delivered via the ephemeral store, so they
      // don't need to be in the auth code's scope set.
      const consentScopes = accept
        ? approvedScopes.filter((s) => !isIdentityScope(s))
        : [];

      const oauthQuery = getSignedOAuthQuery();
      const response = await authClient.oauth2.consent({
        accept,
        ...(accept ? { scope: consentScopes.join(" ") } : {}),
        ...(oauthQuery ? { oauth_query: oauthQuery } : {}),
      });

      if (response.error || !response.data) {
        throw new Error(
          response.error?.message || "Unable to process consent request."
        );
      }

      const redirectUri =
        (response.data as { uri?: string; redirect_uri?: string }).uri ||
        (response.data as { uri?: string; redirect_uri?: string }).redirect_uri;

      if (!redirectUri) {
        throw new Error("Missing redirect URL from consent response.");
      }

      globalThis.window.location.assign(redirectUri);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to process consent request."
      );
      setIsSubmitting(false);
    }
  };

  const hasOptional = optional.length > 0;

  // --- Vault unlock UI based on auth mode ---
  const renderVaultUnlock = () => {
    if (!hasApprovedIdentityScopes) {
      return null;
    }

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
                disabled={isSubmitting || intentLoading}
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
              : () => setVaultState({ status: "gesture_required" })
          }
        />
      );
    }

    if (vaultState.status !== "gesture_required") {
      return null;
    }

    // Passkey: single button that triggers WebAuthn
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

    // OPAQUE: password field + unlock button
    if (authMode === "opaque") {
      return (
        <Alert>
          <Lock className="size-4" />
          <AlertDescription className="space-y-2">
            <p>Enter your password to unlock your identity vault.</p>
            <OpaqueVaultUnlockForm
              disabled={isSubmitting}
              onError={handleVaultError}
              onSuccess={handleProfileLoaded}
            />
          </AlertDescription>
        </Alert>
      );
    }

    // Wallet: sign button
    if (authMode === "wallet" && wallet) {
      return (
        <Alert>
          <Lock className="size-4" />
          <AlertDescription className="space-y-2">
            <p>Sign with your wallet to unlock your identity vault.</p>
            <WalletVaultUnlockButton
              disabled={isSubmitting}
              onError={handleVaultError}
              onSuccess={handleProfileLoaded}
              wallet={wallet}
            />
          </AlertDescription>
        </Alert>
      );
    }

    return null;
  };

  return (
    <div
      className={`mx-auto flex w-full flex-col gap-4 ${isPopup ? "max-w-sm" : "max-w-md"}`}
    >
      <Card>
        <CardHeader className="text-center">
          <div className="mx-auto mb-2">
            <ClientAvatar meta={clientMeta} />
          </div>
          <CardTitle className="text-lg">
            {clientName} wants to access your account
          </CardTitle>
          <CardDescription>
            {hasOptional
              ? "Review required items and choose what else to share."
              : "Review what will be shared."}
            {clientMeta?.uri ? (
              <>
                {" "}
                <a
                  className="inline-flex items-center gap-0.5 text-muted-foreground underline underline-offset-2 hover:text-foreground"
                  href={clientMeta.uri}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  Visit site
                  <ExternalLink className="size-3" />
                </a>
              </>
            ) : null}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {requiredGroups.map((group) => (
            <div key={group.label}>
              <div className="mb-2 flex items-center gap-2">
                <group.icon className="size-4 text-muted-foreground" />
                <p className="font-medium text-sm">{group.label}</p>
              </div>
              <ul className="space-y-1 pl-6">
                {group.scopes.map((scope) => (
                  <li
                    className="flex items-center gap-2 text-muted-foreground text-sm"
                    key={scope}
                  >
                    <span className="size-1 rounded-full bg-muted-foreground/40" />
                    {SCOPE_DESCRIPTIONS[scope] ?? scope}
                  </li>
                ))}
              </ul>
            </div>
          ))}

          {visible.length === 0 && (
            <p className="text-muted-foreground text-sm">
              No additional permissions requested.
            </p>
          )}

          {hasOptional && (
            <>
              <Separator />
              <p className="font-medium text-muted-foreground text-xs">
                Optional — choose what else to share
              </p>
              {optionalGroups.map((group) => (
                <div key={group.label}>
                  <div className="mb-2 flex items-center gap-2">
                    <group.icon className="size-4 text-muted-foreground" />
                    <p className="font-medium text-sm">{group.label}</p>
                  </div>
                  <div className="space-y-2 pl-6">
                    {group.scopes.map((scope) => (
                      <div className="flex items-center gap-2" key={scope}>
                        <Checkbox
                          checked={selectedOptional.includes(scope)}
                          id={`scope-${scope}`}
                          onCheckedChange={() => toggleOptional(scope)}
                        />
                        <Label
                          className="cursor-pointer font-normal text-sm"
                          htmlFor={`scope-${scope}`}
                        >
                          {SCOPE_DESCRIPTIONS[scope] ?? scope}
                        </Label>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </>
          )}

          {renderVaultUnlock()}

          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <div className="flex flex-col gap-2">
            <Button
              disabled={
                isSubmitting ||
                visible.length === 0 ||
                (hasApprovedIdentityScopes &&
                  (vaultState.status !== "loaded" ||
                    !hasValidIdentityIntent ||
                    intentLoading))
              }
              onClick={() => handleConsent(true)}
              type="button"
            >
              {isSubmitting ? (
                <Spinner aria-hidden="true" className="mr-2" size="sm" />
              ) : null}
              Allow
            </Button>
            <Button
              disabled={isSubmitting}
              onClick={() => handleConsent(false)}
              type="button"
              variant="outline"
            >
              Deny
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
