"use client";

import { AlertTriangle, ExternalLink, Lock } from "lucide-react";
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
import { authClient } from "@/lib/auth/auth-client";
import { getSignedOAuthQuery } from "@/lib/auth/oauth-post-login";
import { isIdentityScope } from "@/lib/auth/oidc/identity-scopes";
import {
  groupScopes,
  HIDDEN_SCOPES,
  SCOPE_DESCRIPTIONS,
} from "@/lib/auth/oidc/scope-display";
import {
  getProfileSnapshot,
  getStoredProfile,
  type ProfileSecretPayload,
} from "@/lib/privacy/secrets/profile";

interface ClientMeta {
  name: string;
  icon: string | null;
  uri: string | null;
}

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

function ClientAvatar({ meta }: { meta: ClientMeta | null }) {
  if (meta?.icon) {
    return (
      // biome-ignore lint/performance/noImgElement: external client icon URL, not a static asset
      // biome-ignore lint/correctness/useImageSize: dimensions set via CSS size-12
      <img
        alt={meta.name}
        className="size-12 rounded-full border border-border object-cover"
        src={meta.icon}
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

export function OAuthConsentClient({
  clientId,
  clientMeta,
  optionalScopes,
  scopeParam,
}: Readonly<{
  clientId: string | null;
  clientMeta: ClientMeta | null;
  optionalScopes: string[];
  scopeParam: string;
}>) {
  const clientName = clientMeta?.name ?? clientId ?? "Unknown app";
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

  const hasApprovedIdentityScopes = useMemo(
    () => approvedScopes.some(isIdentityScope),
    [approvedScopes]
  );

  const loadProfile = useCallback(async () => {
    setVaultState({ status: "loading" });
    try {
      const profile = await getStoredProfile();
      if (profile) {
        profileRef.current = profile;
        setVaultState({ status: "loaded" });
      } else {
        profileRef.current = null;
        const { title, remedy } = VAULT_ERRORS.not_enrolled;
        setVaultState({
          status: "not_enrolled",
          error: { category: "not_enrolled", title, remedy },
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      let name: string = typeof err;
      if (err instanceof DOMException) {
        name = `DOMException.${err.name}`;
      } else if (err instanceof Error) {
        name = err.constructor.name;
      }
      console.error(`[consent] Vault unlock failed (${name}): ${msg}`);
      profileRef.current = null;
      setVaultState({ status: "error", error: classifyVaultError(err) });
    }
  }, []);

  // Check synchronous cache on mount — avoids WebAuthn prompt without user gesture
  const cacheChecked = useRef(false);
  useEffect(() => {
    if (!hasApprovedIdentityScopes || cacheChecked.current) {
      return;
    }
    cacheChecked.current = true;

    const cached = getProfileSnapshot();
    if (cached) {
      profileRef.current = cached;
      setVaultState({ status: "loaded" });
    } else {
      setVaultState({ status: "gesture_required" });
    }
  }, [hasApprovedIdentityScopes]);

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
      return;
    }

    const profile = profileRef.current;
    if (!profile) {
      return;
    }

    const identityPayload = buildIdentityPayload(profile);

    const response = await fetch("/api/oauth2/identity/capture", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        oauth_query: oauthQuery,
        scopes: approvedScopes,
        identity: identityPayload,
      }),
    });

    if (!response.ok) {
      // Identity capture failed — proceed without identity claims
      return;
    }
  };

  const handleConsent = async (accept: boolean) => {
    setIsSubmitting(true);
    setError(null);

    try {
      if (accept) {
        await captureIdentityIfNeeded();
      }

      const response = await authClient.oauth2.consent({
        accept,
        ...(accept ? { scope: approvedScopes.join(" ") } : {}),
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

          {hasApprovedIdentityScopes && vaultState.status === "loading" && (
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Spinner aria-hidden="true" size="sm" />
              Unlocking your identity vault…
            </div>
          )}

          {hasApprovedIdentityScopes &&
            vaultState.status === "gesture_required" && (
              <Alert>
                <Lock className="size-4" />
                <AlertDescription className="space-y-2">
                  <p>
                    Unlock your identity vault to share personal information.
                  </p>
                  <Button
                    onClick={loadProfile}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    Unlock vault
                  </Button>
                </AlertDescription>
              </Alert>
            )}

          {hasApprovedIdentityScopes &&
            (vaultState.status === "not_enrolled" ||
              vaultState.status === "error") && (
              <VaultErrorAlert error={vaultState.error} onRetry={loadProfile} />
            )}

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
                (hasApprovedIdentityScopes && vaultState.status !== "loaded")
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
