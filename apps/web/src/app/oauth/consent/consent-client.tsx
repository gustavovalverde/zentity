"use client";

import { useMemo, useState } from "react";

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

function formatClientId(clientId: string | null): string {
  if (!clientId) {
    return "Unknown client";
  }
  if (clientId.length <= 12) {
    return clientId;
  }
  return `${clientId.slice(0, 6)}…${clientId.slice(-4)}`;
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

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConsent = async (accept: boolean) => {
    setIsSubmitting(true);
    setError(null);

    try {
      const response = await authClient.oauth2.consent({
        accept,
        ...(scopeParam ? { scope: scopeParam } : {}),
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
            {formatClientId(clientId)} is requesting access to your identity
            data.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {scopes.length > 0 ? (
            <div className="rounded-md border border-dashed px-3 py-2 text-sm">
              <p className="font-medium">Requested scopes</p>
              <p className="text-muted-foreground text-xs">
                {scopes.join(", ")}
              </p>
            </div>
          ) : (
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
              disabled={isSubmitting}
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
