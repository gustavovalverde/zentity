"use client";

import type { AuthMode } from "@/lib/auth/detect-auth-mode";

import { Lock } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { isIdentityScope } from "@/lib/auth/oidc/identity-scopes";
import {
  getStoredProfile,
  type ProfileSecretPayload,
  resetProfileSecretCache,
} from "@/lib/privacy/secrets/profile";

interface AuthorizationDetail {
  amount?: { currency?: string; value?: string };
  item?: string;
  merchant?: string;
  type?: string;
  [key: string]: unknown;
}

interface CibaRequestDetails {
  auth_req_id: string;
  authorization_details?: AuthorizationDetail[];
  binding_message?: string;
  client_name?: string;
  expires_at: string;
  scope: string;
  status: string;
}

interface IdentityIntentState {
  expiresAt: number;
  scopeKey: string;
  token: string;
}

type PageState =
  | "loading"
  | "ready"
  | "approving"
  | "rejecting"
  | "approved"
  | "rejected"
  | "expired"
  | "error";

const INTENT_EXPIRY_GRACE_MS = 2000;

export function CibaApproveClient({
  authMode,
  wallet,
}: Readonly<{
  authMode: AuthMode;
  wallet: { address: string; chainId: number } | null;
}>) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const authReqId = searchParams.get("auth_req_id");

  const [state, setState] = useState<PageState>("loading");
  const [details, setDetails] = useState<CibaRequestDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [timeLeft, setTimeLeft] = useState<number>(0);

  useEffect(() => {
    if (!authReqId) {
      setError("Missing auth_req_id parameter");
      setState("error");
      return;
    }

    fetch(`/api/auth/ciba/verify?auth_req_id=${encodeURIComponent(authReqId)}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
            error_description?: string;
          };
          if (body.error === "expired_token") {
            setState("expired");
            return;
          }
          throw new Error(body.error_description ?? "Failed to load request");
        }
        const data = (await res.json()) as CibaRequestDetails;
        setDetails(data);

        if (data.status === "approved") {
          setState("approved");
        } else if (data.status === "rejected") {
          setState("rejected");
        } else {
          const expiresMs = new Date(data.expires_at).getTime() - Date.now();
          if (expiresMs <= 0) {
            setState("expired");
          } else {
            setTimeLeft(Math.ceil(expiresMs / 1000));
            setState("ready");
          }
        }
      })
      .catch((err: Error) => {
        setError(err.message);
        setState("error");
      });
  }, [authReqId]);

  useEffect(() => {
    if (state !== "ready" || timeLeft <= 0) {
      return;
    }

    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          setState("expired");
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [state, timeLeft]);

  // ── Identity vault unlock state ──────────────────────────

  const scopes = useMemo(
    () => details?.scope.split(" ").filter(Boolean) ?? [],
    [details?.scope]
  );

  const hasIdentityScopes = useMemo(
    () => scopes.some(isIdentityScope),
    [scopes]
  );

  const scopeKey = useMemo(() => buildScopeKey(scopes), [scopes]);

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

  const handleVaultError = useCallback((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    let name: string = typeof err;
    if (err instanceof DOMException) {
      name = `DOMException.${err.name}`;
    } else if (err instanceof Error) {
      name = err.constructor.name;
    }
    console.error(`[ciba-approve] Vault unlock failed (${name}): ${msg}`);
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
    if (!authReqId) {
      return;
    }

    setIntentLoading(true);
    setIntentError(null);
    try {
      const response = await fetch("/api/ciba/identity/intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auth_req_id: authReqId, scopes }),
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
  }, [authReqId, scopeKey, scopes]);

  // Reset vault state when identity scopes are detected
  useEffect(() => {
    if (!hasIdentityScopes || state !== "ready") {
      return;
    }

    resetProfileSecretCache();
    profileRef.current = null;
    setIdentityIntent(null);
    setIntentError(null);
    setIntentLoading(false);
    setVaultState({ status: "gesture_required" });
  }, [hasIdentityScopes, state]);

  // Auto-fetch intent token once vault is unlocked
  useEffect(() => {
    if (!hasIdentityScopes || vaultState.status !== "loaded") {
      return;
    }
    if (hasValidIdentityIntent || intentLoading) {
      return;
    }
    fetchIdentityIntent().catch(() => undefined);
  }, [
    fetchIdentityIntent,
    hasIdentityScopes,
    hasValidIdentityIntent,
    intentLoading,
    vaultState.status,
  ]);

  // ── Actions ──────────────────────────────────────────────

  const stageIdentityAndApprove = useCallback(async (): Promise<void> => {
    if (!authReqId) {
      return;
    }

    const profile = profileRef.current;
    if (!profile) {
      throw new Error("Unlock your identity vault before approving.");
    }

    if (!(identityIntent && hasValidIdentityIntent)) {
      throw new Error(
        "Secure identity consent expired. Unlock your vault and try again."
      );
    }

    const identityPayload = buildIdentityPayload(profile);

    const response = await fetch("/api/ciba/identity/stage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        auth_req_id: authReqId,
        scopes,
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
  }, [authReqId, identityIntent, hasValidIdentityIntent, scopes]);

  const handleAction = useCallback(
    async (action: "authorize" | "reject") => {
      if (!authReqId) {
        return;
      }

      setState(action === "authorize" ? "approving" : "rejecting");
      setError(null);

      try {
        if (action === "authorize" && hasIdentityScopes) {
          if (vaultState.status !== "loaded") {
            throw new Error("Unlock your identity vault before approving.");
          }
          if (!hasValidIdentityIntent) {
            throw new Error(
              "Secure identity consent expired. Unlock your vault and try again."
            );
          }
          await stageIdentityAndApprove();
        }

        const res = await fetch(`/api/auth/ciba/${action}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ auth_req_id: authReqId }),
        });

        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error_description?: string;
          };
          throw new Error(body.error_description ?? `Failed to ${action}`);
        }

        setState(action === "authorize" ? "approved" : "rejected");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
        setState("ready");
      }
    },
    [
      authReqId,
      hasIdentityScopes,
      vaultState.status,
      hasValidIdentityIntent,
      stageIdentityAndApprove,
    ]
  );

  // ── Vault unlock UI ──────────────────────────────────────

  const renderVaultUnlock = () => {
    if (!hasIdentityScopes) {
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
                disabled={state === "approving" || intentLoading}
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
              disabled={state === "approving"}
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
              disabled={state === "approving"}
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

  // ── Render ───────────────────────────────────────────────

  const displayScopes =
    details?.scope.split(" ").filter((s) => s !== "openid") ?? [];

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const isActing = state === "approving" || state === "rejecting";

  if (state === "loading") {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner className="size-8" />
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className="mx-auto max-w-md py-10">
        <Card>
          <CardHeader>
            <CardTitle>Error</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
          <CardFooter>
            <Button
              onClick={() => router.push("/dashboard/ciba")}
              variant="outline"
            >
              Back to Agent Requests
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  if (state === "expired") {
    return (
      <div className="mx-auto max-w-md py-10">
        <Card>
          <CardHeader>
            <CardTitle>Request Expired</CardTitle>
            <CardDescription>
              This authorization request has expired. The requesting application
              will need to send a new request.
            </CardDescription>
          </CardHeader>
          <CardFooter>
            <Button
              onClick={() => router.push("/dashboard/ciba")}
              variant="outline"
            >
              Back to Agent Requests
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  if (state === "approved" || state === "rejected") {
    return (
      <div className="mx-auto max-w-md py-10">
        <Card>
          <CardHeader>
            <CardTitle>
              Request {state === "approved" ? "Approved" : "Denied"}
            </CardTitle>
            <CardDescription>
              {state === "approved"
                ? `You have granted ${details?.client_name ?? "the application"} access to your account.`
                : `You have denied the request from ${details?.client_name ?? "the application"}.`}
            </CardDescription>
          </CardHeader>
          <CardFooter>
            <Button
              onClick={() => router.push("/dashboard/ciba")}
              variant="outline"
            >
              Back to Agent Requests
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md py-10">
      <Card>
        <CardHeader>
          <CardTitle>Authorization Request</CardTitle>
          <CardDescription>
            <strong>{details?.client_name ?? "An application"}</strong> is
            requesting access to your account.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {displayScopes.length > 0 && (
            <div>
              <p className="mb-2 font-medium text-sm">Requested scopes</p>
              <div className="flex flex-wrap gap-2">
                {displayScopes.map((scope) => (
                  <Badge key={scope} variant="secondary">
                    {scope}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {details?.authorization_details &&
            details.authorization_details.length > 0 && (
              <div className="space-y-2">
                {details.authorization_details.map((detail, i) => (
                  <div
                    className="rounded-lg border bg-muted/50 p-4"
                    key={`detail-${detail.type ?? i}`}
                  >
                    <p className="mb-2 font-semibold text-muted-foreground text-xs uppercase tracking-wider">
                      {detail.type ?? "Details"}
                    </p>
                    {detail.type === "purchase" ? (
                      <div className="space-y-1">
                        {detail.item && (
                          <p className="font-medium">{detail.item}</p>
                        )}
                        {detail.amount?.value && (
                          <p className="font-bold text-lg">
                            ${detail.amount.value}{" "}
                            <span className="font-normal text-muted-foreground text-sm">
                              {detail.amount.currency ?? "USD"}
                            </span>
                          </p>
                        )}
                        {detail.merchant && (
                          <p className="text-muted-foreground text-sm">
                            Merchant: {detail.merchant}
                          </p>
                        )}
                      </div>
                    ) : (
                      <dl className="space-y-1 text-sm">
                        {Object.entries(detail)
                          .filter(([k]) => k !== "type")
                          .map(([k, v]) => (
                            <div className="flex gap-2" key={k}>
                              <dt className="font-medium">{k}:</dt>
                              <dd className="text-muted-foreground">
                                {typeof v === "string" ? v : JSON.stringify(v)}
                              </dd>
                            </div>
                          ))}
                      </dl>
                    )}
                  </div>
                ))}
              </div>
            )}

          {details?.binding_message && (
            <div className="rounded-md bg-muted p-3">
              <p className="font-medium text-sm">Message</p>
              <p className="text-muted-foreground text-sm">
                {details.binding_message}
              </p>
            </div>
          )}

          {renderVaultUnlock()}

          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <p className="text-muted-foreground text-sm">
            Expires in {formatTime(timeLeft)}
          </p>
        </CardContent>

        <CardFooter className="flex gap-3">
          <Button
            className="flex-1"
            disabled={isActing}
            onClick={() => handleAction("reject")}
            variant="outline"
          >
            {state === "rejecting" ? "Denying..." : "Deny"}
          </Button>
          <Button
            className="flex-1"
            disabled={
              isActing ||
              (hasIdentityScopes &&
                (vaultState.status !== "loaded" ||
                  !hasValidIdentityIntent ||
                  intentLoading))
            }
            onClick={() => handleAction("authorize")}
          >
            {state === "approving" ? "Approving..." : "Approve"}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
