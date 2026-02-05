"use client";

import { useEffect, useMemo, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { authClient } from "@/lib/auth/auth-client";
import { getSignedOAuthQuery } from "@/lib/auth/oauth-post-login";
import {
  IDENTITY_SCOPE_DESCRIPTIONS,
  IDENTITY_SCOPES,
  isIdentityScope,
} from "@/lib/auth/oidc/identity-scopes";
import {
  getStoredProfile,
  type ProfileSecretPayload,
} from "@/lib/privacy/secrets/profile";

/**
 * Scope descriptions for the consent UI.
 * Identity scopes have detailed descriptions since they involve PII.
 */
const SCOPE_DESCRIPTIONS: Record<string, string> = {
  // Standard OIDC scopes
  openid: "Basic authentication",
  profile: "Profile information",
  email: "Email address",
  offline_access: "Access when you're not using the app",
  // Verifiable credential scope
  "vc:identity": "Verification status (no personal data)",
  identity: "Verification status (no personal data)",
  // Identity scopes (RFC-0025)
  ...IDENTITY_SCOPE_DESCRIPTIONS,
};

function formatClientId(clientId: string | null): string {
  if (!clientId) {
    return "Unknown client";
  }
  if (clientId.length <= 12) {
    return clientId;
  }
  return `${clientId.slice(0, 6)}…${clientId.slice(-4)}`;
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

export function OAuthConsentClient({
  clientId,
  scopeParam,
}: Readonly<{
  clientId: string | null;
  scopeParam: string;
}>) {
  const scopes = useMemo(
    () =>
      scopeParam
        .split(" ")
        .map((scope) => scope.trim())
        .filter(Boolean),
    [scopeParam]
  );

  const identityScopes = useMemo(
    () => scopes.filter(isIdentityScope),
    [scopes]
  );

  const standardScopes = useMemo(
    () => scopes.filter((s) => !isIdentityScope(s)),
    [scopes]
  );

  const [selectedIdentityScopes, setSelectedIdentityScopes] =
    useState<string[]>(identityScopes);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSelectedIdentityScopes(identityScopes);
  }, [identityScopes]);

  const approvedScopes = useMemo(
    () => [...standardScopes, ...selectedIdentityScopes],
    [standardScopes, selectedIdentityScopes]
  );

  const toggleIdentityScope = (scope: string) => {
    setSelectedIdentityScopes((prev) =>
      prev.includes(scope)
        ? prev.filter((item) => item !== scope)
        : [...prev, scope]
    );
  };

  const captureIdentityIfNeeded = async (): Promise<void> => {
    if (selectedIdentityScopes.length === 0) {
      return;
    }

    const oauthQuery = getSignedOAuthQuery();
    if (!oauthQuery) {
      throw new Error(
        "Missing OAuth context. Please restart the sign-in flow."
      );
    }

    const profile = await getStoredProfile();
    if (!profile) {
      throw new Error(
        "Unable to unlock your identity data. Continue without sharing identity details or retry."
      );
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
      const errorBody = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      throw new Error(
        errorBody?.error || "Unable to store identity data for this request."
      );
    }

    const result = (await response.json()) as {
      stored?: boolean;
      fieldsCount?: number;
    };

    if (!result.stored) {
      throw new Error(
        "No identity data was stored. Continue without sharing identity details or retry."
      );
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

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Approve access request</CardTitle>
          <CardDescription>
            {formatClientId(clientId)} is requesting access to your account.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {identityScopes.length > 0 && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-3 dark:border-amber-800 dark:bg-amber-950">
              <p className="font-medium text-amber-900 dark:text-amber-100">
                Personal Information
              </p>
              <p className="mb-2 text-muted-foreground text-xs">
                Select which identity details to share with{" "}
                {formatClientId(clientId)}.
              </p>
              <ul className="space-y-2 text-sm">
                {IDENTITY_SCOPES.filter((scope) =>
                  identityScopes.includes(scope)
                ).map((scope) => (
                  <li className="flex items-start gap-2" key={scope}>
                    <input
                      checked={selectedIdentityScopes.includes(scope)}
                      className="mt-1"
                      onChange={() => toggleIdentityScope(scope)}
                      type="checkbox"
                    />
                    <span>{SCOPE_DESCRIPTIONS[scope] ?? scope}</span>
                  </li>
                ))}
              </ul>
              {selectedIdentityScopes.length === 0 && (
                <p className="mt-2 text-amber-700 text-xs dark:text-amber-200">
                  No identity details selected. You can still continue without
                  sharing personal data.
                </p>
              )}
            </div>
          )}

          {standardScopes.length > 0 && (
            <div className="rounded-md border border-dashed px-3 py-2 text-sm">
              <p className="font-medium">Additional permissions</p>
              <ul className="mt-1 space-y-1">
                {standardScopes.map((scope) => (
                  <li
                    className="flex items-start gap-2 text-muted-foreground text-xs"
                    key={scope}
                  >
                    <span>•</span>
                    <span>{SCOPE_DESCRIPTIONS[scope] ?? scope}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {scopes.length === 0 && (
            <p className="text-muted-foreground text-sm">
              No additional permissions requested.
            </p>
          )}

          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <div className="flex flex-col gap-2">
            <Button
              disabled={isSubmitting || approvedScopes.length === 0}
              onClick={() => handleConsent(true)}
              type="button"
            >
              {isSubmitting ? (
                <Spinner aria-hidden="true" className="mr-2" size="sm" />
              ) : null}
              Approve
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
