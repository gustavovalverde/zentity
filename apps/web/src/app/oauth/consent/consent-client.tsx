"use client";

import type { SecurityBadgeInput } from "./_components/security-badges";

import { ExternalLink } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

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
  fetchIntentFromEndpoint,
  useVaultUnlock,
} from "@/components/vault-unlock/use-vault-unlock";
import {
  buildIdentityPayload,
  buildScopeKey,
} from "@/components/vault-unlock/vault-unlock";
import { VaultUnlockPanel } from "@/components/vault-unlock/vault-unlock-panel";
import { authClient } from "@/lib/auth/auth-client";
import { getSignedOAuthQuery } from "@/lib/auth/oauth-post-login";
import { isIdentityScope } from "@/lib/auth/oidc/identity-scopes";
import {
  groupScopes,
  HIDDEN_SCOPES,
  SCOPE_DESCRIPTIONS,
} from "@/lib/auth/oidc/scope-display";

import { ClientSecurityBadges } from "./_components/client-security-badges";

interface ClientMeta {
  icon: string | null;
  metadataUrl: string | null;
  name: string;
  redirectUris: string[] | null;
  uri: string | null;
}

function isSafeImageSrc(url: string): boolean {
  if (url.startsWith("data:image/")) {
    return true;
  }
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

function ClientAvatar({ meta }: { meta: ClientMeta | null }) {
  const safeIcon = meta?.icon && isSafeImageSrc(meta.icon) ? meta.icon : null;

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

  const letter = (meta?.name ?? "?")[0]?.toUpperCase() ?? "?";
  return (
    <div className="flex size-12 items-center justify-center rounded-full bg-muted font-semibold text-lg text-muted-foreground">
      {letter}
    </div>
  );
}

export function OAuthConsentClient({
  clientId,
  clientHostname,
  clientMeta,
  isLocalApp,
  optionalScopes,
  scopeParam,
  securityBadgeInput,
  authMode,
  wallet,
}: Readonly<{
  clientId: string | null;
  clientHostname: string | null;
  clientMeta: ClientMeta | null;
  isLocalApp: boolean;
  optionalScopes: string[];
  scopeParam: string;
  securityBadgeInput: SecurityBadgeInput | null;
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
  const hasApprovedIdentityScopes = useMemo(
    () => approvedScopes.some(isIdentityScope),
    [approvedScopes]
  );
  const approvedScopeKey = useMemo(
    () => buildScopeKey(approvedScopes),
    [approvedScopes]
  );

  const fetchIntentToken = useCallback(() => {
    const oauthQuery = getSignedOAuthQuery();
    if (!oauthQuery) {
      throw new Error("Missing OAuth context for identity consent.");
    }
    return fetchIntentFromEndpoint("/api/oauth2/identity/intent", {
      oauth_query: oauthQuery,
      scopes: approvedScopes,
    });
  }, [approvedScopes]);

  const vault = useVaultUnlock({
    logTag: "consent",
    scopeKey: approvedScopeKey,
    active: hasApprovedIdentityScopes,
    fetchIntentToken,
  });

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

    const profile = vault.profileRef.current;
    if (!profile) {
      throw new Error("Unlock your identity vault before allowing access.");
    }

    if (!(vault.identityIntent && vault.hasValidIdentityIntent)) {
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
        intent_token: vault.identityIntent.token,
      }),
    });

    const body = (await response.json().catch(() => null)) as {
      staged?: boolean;
      error?: string;
    } | null;

    if (!response.ok) {
      vault.clearIntent();
      throw new Error(body?.error || "Unable to stage identity claims.");
    }
    if (!body?.staged) {
      vault.clearIntent();
      throw new Error("Identity claims were not staged.");
    }

    vault.clearIntent();
  };

  const handleConsent = async (accept: boolean) => {
    setIsSubmitting(true);
    setError(null);

    let didStage = false;
    try {
      if (accept && hasApprovedIdentityScopes) {
        if (vault.vaultState.status !== "loaded") {
          throw new Error("Unlock your identity vault before allowing access.");
        }
        if (!vault.hasValidIdentityIntent) {
          throw new Error(
            "Secure identity consent expired. Unlock your vault and try again."
          );
        }

        // Stage identity claims in the ephemeral store BEFORE creating the
        // consent record. The server's userinfo path consumes them on first
        // read after token issuance. Identity scopes are never persisted in
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
        ...(accept && consentScopes.length > 0
          ? { scope: consentScopes.join(" ") }
          : {}),
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
          {clientHostname && (
            <p className="text-muted-foreground text-xs">{clientHostname}</p>
          )}
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
          {isLocalApp && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-amber-800 text-xs dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
              Local app — authorization code delivered to a local application
            </div>
          )}
          <ClientSecurityBadges input={securityBadgeInput} />
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

          <VaultUnlockPanel
            active={hasApprovedIdentityScopes}
            authMode={authMode}
            disabled={isSubmitting}
            vault={vault}
            wallet={wallet}
          />

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
                  (vault.vaultState.status !== "loaded" ||
                    !vault.hasValidIdentityIntent ||
                    vault.intentLoading))
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
