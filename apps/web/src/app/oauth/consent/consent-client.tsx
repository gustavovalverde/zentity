"use client";

import { ExternalLink, Lock } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import {
  buildIdentityPayload,
  buildScopeKey,
  classifyVaultError,
  OpaqueVaultUnlockForm,
  VAULT_ERRORS,
  VaultErrorAlert,
  type VaultState,
  WalletVaultUnlockButton,
} from "@/components/vault-unlock";
import { authClient } from "@/lib/auth/auth-client";
import { getSignedOAuthQuery } from "@/lib/auth/oauth-post-login";
import { isIdentityScope } from "@/lib/auth/oidc/identity-scopes";
import {
  groupScopes,
  HIDDEN_SCOPES,
  SCOPE_DESCRIPTIONS,
} from "@/lib/auth/oidc/scope-display";
import {
  getStoredProfile,
  type ProfileSecretPayload,
  resetProfileSecretCache,
} from "@/lib/privacy/secrets/profile";

interface ClientMeta {
  icon: string | null;
  name: string;
  uri: string | null;
}

interface IdentityIntentState {
  expiresAt: number;
  scopeKey: string;
  token: string;
}

const INTENT_EXPIRY_GRACE_MS = 2000;

function isHttpsUrl(url: string): boolean {
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
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

    let didStage = false;
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
        didStage = true;
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

      const data = response.data as {
        url?: string;
        uri?: string;
        redirect_uri?: string;
      };
      const redirectUri = data.url || data.uri || data.redirect_uri;

      if (!redirectUri) {
        throw new Error("Missing redirect URL from consent response.");
      }

      globalThis.window.location.assign(redirectUri);
    } catch (err) {
      // If staging succeeded but consent failed, clear the stale ephemeral
      // entry so the user can retry without hitting "concurrent_stage".
      if (didStage) {
        const oauthQuery = getSignedOAuthQuery();
        if (oauthQuery) {
          fetch("/api/oauth2/identity/unstage", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ oauth_query: oauthQuery }),
          }).catch(() => undefined);
        }
      }

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
            {clientName} wants to access your{" "}
            {hasApprovedIdentityScopes ? "personal information" : "account"}
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
              Basic sign-in only — no additional data will be shared.
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
