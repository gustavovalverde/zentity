"use client";

import type {
  AgentIdentitySummary,
  CibaRequestDetails,
  RegisteredAgentInfo,
} from "@/lib/agents/resolve-approval";
import type { AuthMode } from "@/lib/auth/session";

import { AlertTriangle, BadgeCheck, Bot } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
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
  fetchIntentFromEndpoint,
  useVaultUnlock,
  VaultUnlockPanel,
} from "@/components/vault-unlock";
import {
  findMissingIdentityFields,
  IDENTITY_SCOPE_DESCRIPTIONS,
  type IdentityScope,
  isIdentityScope,
  isProofScope,
  PROOF_SCOPE_DESCRIPTIONS,
  type ProofScope,
} from "@/lib/auth/oidc/disclosure/registry";
import { formatAcrValue } from "@/lib/terminology";

type PageState =
  | "loading"
  | "ready"
  | "approving"
  | "rejecting"
  | "approved"
  | "rejected"
  | "expired"
  | "error";

function RequestedClaimsSection({ scopes }: Readonly<{ scopes: string[] }>) {
  const proofScopes = scopes.filter(isProofScope) as ProofScope[];
  const identityScopes = scopes.filter(isIdentityScope) as IdentityScope[];

  if (proofScopes.length === 0 && identityScopes.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2 rounded-md border p-3">
      <p className="font-medium text-sm">Information requested</p>
      <ul className="space-y-1.5 text-sm">
        {proofScopes.map((scope) => (
          <li className="flex items-start gap-2" key={scope}>
            <BadgeCheck className="mt-0.5 size-3.5 shrink-0 text-success" />
            <span>
              {PROOF_SCOPE_DESCRIPTIONS[scope]}
              <span className="ml-1 text-muted-foreground text-xs">
                — anonymous, no personal data shared
              </span>
            </span>
          </li>
        ))}
        {identityScopes.map((scope) => (
          <li className="flex items-start gap-2" key={scope}>
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" />
            <span>
              {IDENTITY_SCOPE_DESCRIPTIONS[scope]}
              <span className="ml-1 text-muted-foreground text-xs">
                — requires unlocking your vault
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function resolveTerminalState(message: string): PageState | null {
  const lower = message.toLowerCase();
  if (lower.includes("already approved")) {
    return "approved";
  }
  if (lower.includes("already rejected")) {
    return "rejected";
  }
  if (lower.includes("expired")) {
    return "expired";
  }
  return null;
}

interface InteractionCopy {
  deniedDescription?: string;
  description?: string;
  requestedProfileFields?: string[];
  successDescription?: string;
  title?: string;
}

function deriveInitialState(req?: CibaRequestDetails): {
  pageState: PageState;
  secondsLeft: number;
} {
  if (!req) {
    return { pageState: "loading", secondsLeft: 0 };
  }
  if (req.status === "approved") {
    return { pageState: "approved", secondsLeft: 0 };
  }
  if (req.status === "rejected") {
    return { pageState: "rejected", secondsLeft: 0 };
  }
  const expiresMs = new Date(req.expires_at).getTime() - Date.now();
  if (expiresMs <= 0) {
    return { pageState: "expired", secondsLeft: 0 };
  }
  return { pageState: "ready", secondsLeft: Math.ceil(expiresMs / 1000) };
}

export function AgentApprovalView({
  agentIdentity,
  authMode,
  authReqId,
  initialRequest,
  interactionCopy,
  onClose,
  registeredAgent,
  userTier = 0,
  wallet,
}: Readonly<{
  agentIdentity?: AgentIdentitySummary | null;
  authMode: AuthMode;
  authReqId: string | null;
  initialRequest?: CibaRequestDetails;
  interactionCopy?: InteractionCopy | null;
  onClose?: () => void;
  registeredAgent?: RegisteredAgentInfo | null;
  userTier?: 0 | 1 | 2 | 3;
  wallet: { address: string; chainId: number } | null;
}>) {
  const router = useRouter();

  const navigateBack = useCallback(() => {
    if (onClose) {
      onClose();
    } else {
      router.push("/dashboard/agents");
    }
  }, [onClose, router]);

  const initialDerived = deriveInitialState(initialRequest);
  const [state, setState] = useState<PageState>(initialDerived.pageState);
  const [details, setDetails] = useState<CibaRequestDetails | null>(
    initialRequest ?? null
  );
  const [error, setError] = useState<string | null>(null);
  const [timeLeft, setTimeLeft] = useState<number>(initialDerived.secondsLeft);
  const [assuranceTier, setAssuranceTier] = useState(userTier);

  const hasInitialRequest = initialRequest != null;

  useEffect(() => {
    if (hasInitialRequest) {
      return;
    }

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
  }, [authReqId, hasInitialRequest]);

  // Real-time status updates via service worker push messages
  useEffect(() => {
    if (!authReqId || typeof navigator === "undefined") {
      return;
    }
    const sw = navigator.serviceWorker;
    if (!sw) {
      return;
    }

    const reqId = authReqId;
    function onMessage(event: MessageEvent) {
      if (
        event.data?.type === "ciba:status-changed" &&
        event.data?.authReqId === reqId
      ) {
        fetch(`/api/auth/ciba/verify?auth_req_id=${encodeURIComponent(reqId)}`)
          .then(async (res) => {
            if (!res.ok) {
              return;
            }
            const data = (await res.json()) as CibaRequestDetails;
            setDetails(data);
            if (data.status === "approved") {
              setState("approved");
            } else if (data.status === "rejected") {
              setState("rejected");
            }
          })
          .catch(() => undefined);
      }
    }

    sw.addEventListener("message", onMessage);
    return () => sw.removeEventListener("message", onMessage);
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

  useEffect(() => {
    setAssuranceTier(userTier);
  }, [userTier]);

  // ── Identity vault unlock ──────────────────────────────────

  const scopes = useMemo(
    () => details?.scope.split(" ").filter(Boolean) ?? [],
    [details?.scope]
  );

  const hasIdentityScopes = useMemo(
    () => scopes.some(isIdentityScope),
    [scopes]
  );

  const scopeKey = useMemo(() => buildScopeKey(scopes), [scopes]);

  const vaultActive = hasIdentityScopes && state === "ready";

  const fetchIntentToken = useCallback(() => {
    if (!authReqId) {
      throw new Error("Missing auth request ID.");
    }
    return fetchIntentFromEndpoint("/api/ciba/identity/intent", {
      auth_req_id: authReqId,
      scopes,
    });
  }, [authReqId, scopes]);

  const hasProofScopes = useMemo(() => scopes.some(isProofScope), [scopes]);

  const vault = useVaultUnlock({
    logTag: "ciba-approve",
    scopeKey,
    active: vaultActive,
    fetchIntentToken,
  });
  const vaultStatus = vault.vaultState.status;

  const missingIdentityFields = useMemo(() => {
    if (!hasIdentityScopes || vaultStatus !== "loaded") {
      return [] as string[];
    }

    const profile = vault.profileRef.current;
    if (!profile) {
      return [] as string[];
    }

    return findMissingIdentityFields(
      buildIdentityPayload(profile) as Record<string, unknown>,
      scopes
    );
  }, [hasIdentityScopes, vaultStatus, vault.profileRef, scopes]);

  const refreshAssuranceTier = useCallback(async () => {
    try {
      const res = await fetch("/api/trpc/assurance.profile", {
        credentials: "include",
      });
      const data = (await res.json().catch(() => null)) as {
        result?: {
          data?: { json?: { assurance?: { tier?: number }; tier?: number } };
        };
      } | null;
      const tier =
        data?.result?.data?.json?.assurance?.tier ??
        data?.result?.data?.json?.tier;
      if (tier === 0 || tier === 1 || tier === 2 || tier === 3) {
        setAssuranceTier(tier);
      }
    } catch {
      // Keep the last known tier if the refresh fails.
    }
  }, []);

  useEffect(() => {
    if (!(hasProofScopes && state === "ready")) {
      return;
    }

    if (vaultStatus !== "loaded") {
      return;
    }

    refreshAssuranceTier().catch(() => undefined);
  }, [hasProofScopes, state, vaultStatus, refreshAssuranceTier]);

  useEffect(() => {
    if (!(hasProofScopes && state === "ready")) {
      return;
    }

    const handlePageResume = () => {
      if (document.visibilityState !== "hidden") {
        refreshAssuranceTier().catch(() => undefined);
      }
    };

    window.addEventListener("focus", handlePageResume);
    document.addEventListener("visibilitychange", handlePageResume);

    return () => {
      window.removeEventListener("focus", handlePageResume);
      document.removeEventListener("visibilitychange", handlePageResume);
    };
  }, [hasProofScopes, state, refreshAssuranceTier]);

  // ── Verification check (proof scopes need completed verification) ──

  const verificationMissing = hasProofScopes && assuranceTier < 2;

  // ── Actions ──────────────────────────────────────────────

  const { profileRef, identityIntent, hasValidIdentityIntent, clearIntent } =
    vault;

  // biome-ignore lint/correctness/useExhaustiveDependencies: profileRef is a stable React ref — .current is intentionally read without dependency tracking
  const stageIdentityAndApprove = useCallback(async (): Promise<void> => {
    if (!authReqId) {
      return;
    }

    const profile = profileRef.current;
    if (!profile) {
      throw new Error("Unlock your vault to approve this request.");
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
      clearIntent();
      throw new Error(body?.error || "Unable to stage identity claims.");
    }
    if (!body?.staged) {
      clearIntent();
      throw new Error(
        "Your profile does not contain the requested data. Complete identity verification first."
      );
    }

    clearIntent();
  }, [authReqId, identityIntent, hasValidIdentityIntent, scopes, clearIntent]);

  const handleAction = useCallback(
    async (action: "authorize" | "reject") => {
      if (!authReqId) {
        return;
      }

      setState(action === "authorize" ? "approving" : "rejecting");
      setError(null);

      let didStage = false;
      try {
        if (action === "authorize" && hasIdentityScopes) {
          if (vault.vaultState.status !== "loaded") {
            throw new Error("Unlock your vault to approve this request.");
          }
          if (!hasValidIdentityIntent) {
            throw new Error(
              "Secure identity consent expired. Unlock your vault and try again."
            );
          }
          await stageIdentityAndApprove();
          didStage = true;
        }

        const res = await fetch(`/api/auth/ciba/${action}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ auth_req_id: authReqId }),
        });

        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error_description?: string;
            message?: string;
          };
          throw new Error(
            body.error_description ?? body.message ?? `Failed to ${action}`
          );
        }

        setState(action === "authorize" ? "approved" : "rejected");
      } catch (err) {
        if (didStage) {
          fetch("/api/ciba/identity/unstage", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ auth_req_id: authReqId }),
          }).catch(() => undefined);
        }

        const message = err instanceof Error ? err.message : "Unknown error";
        const terminalState = resolveTerminalState(message);
        if (terminalState) {
          setState(terminalState);
        } else {
          setError(message);
          setState("ready");
        }
      }
    },
    [
      authReqId,
      hasIdentityScopes,
      vault.vaultState.status,
      hasValidIdentityIntent,
      stageIdentityAndApprove,
    ]
  );

  // ── Render ───────────────────────────────────────────────

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const isActing = state === "approving" || state === "rejecting";
  const containerClass = onClose ? "" : "mx-auto max-w-md py-10";

  if (state === "loading") {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner className="size-8" />
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className={containerClass}>
        <Card>
          <CardHeader>
            <CardTitle>Error</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
          <CardFooter>
            <Button onClick={navigateBack} variant="outline">
              Back to Agents
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  if (state === "expired") {
    return (
      <div className={containerClass}>
        <Card>
          <CardHeader>
            <CardTitle>Request Expired</CardTitle>
            <CardDescription>
              This authorization request has expired. The requesting application
              will need to send a new request.
            </CardDescription>
          </CardHeader>
          <CardFooter>
            <Button onClick={navigateBack} variant="outline">
              Back to Agents
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  if (state === "approved" || state === "rejected") {
    const rejectedDescription = error
      ? error
      : (interactionCopy?.deniedDescription ??
        `You have denied the request from ${details?.client_name ?? "the application"}.`);

    return (
      <div className={containerClass}>
        <Card>
          <CardHeader>
            <CardTitle>
              Request {state === "approved" ? "Approved" : "Denied"}
            </CardTitle>
            <CardDescription>
              {state === "approved"
                ? (interactionCopy?.successDescription ??
                  `You have granted ${details?.client_name ?? "the application"} access to your account.`)
                : rejectedDescription}
            </CardDescription>
          </CardHeader>
          <CardFooter>
            <Button onClick={navigateBack} variant="outline">
              Back to Agents
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  return (
    <div className={containerClass}>
      <Card>
        <CardHeader>
          <CardTitle>
            {interactionCopy?.title ??
              (details?.binding_message
                ? `${details?.client_name ?? "An application"} wants to ${details.binding_message}`
                : `${details?.client_name ?? "An application"} is requesting access`)}
          </CardTitle>
          <CardDescription>
            {interactionCopy?.description ?? (
              <>
                Review what{" "}
                <strong>{details?.client_name ?? "the application"}</strong>{" "}
                wants to do on your behalf.
              </>
            )}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Requesting app — merged host + agent into one compact line */}
          {(registeredAgent || agentIdentity) && (
            <div
              className={`flex items-center gap-3 rounded-md border p-3 ${
                registeredAgent?.attestationTier === "attested"
                  ? "border-success/30"
                  : "border-warning/30"
              }`}
            >
              {registeredAgent?.attestationTier === "attested" ? (
                <BadgeCheck className="size-4 shrink-0 text-success" />
              ) : (
                <Bot className="size-4 shrink-0 text-warning" />
              )}
              <div className="min-w-0 text-sm">
                <span className="font-medium">
                  {agentIdentity?.name ?? registeredAgent?.hostName}
                </span>
                {agentIdentity?.name && registeredAgent && (
                  <span className="ml-1.5 text-muted-foreground">
                    via {registeredAgent.hostName}
                  </span>
                )}
                {(agentIdentity?.model || agentIdentity?.runtime) && (
                  <p className="truncate text-muted-foreground text-xs">
                    {[agentIdentity.model, agentIdentity.runtime]
                      .filter(Boolean)
                      .join(" / ")}
                  </p>
                )}
              </div>
            </div>
          )}
          {!(registeredAgent || agentIdentity) && details && (
            <div className="flex items-start gap-2 rounded-md border border-warning/30 p-3">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" />
              <p className="text-sm">No agent identity disclosed.</p>
            </div>
          )}

          {/* Purchase details (authorization_details) */}
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

          {details?.acr_values && (
            <div className="flex items-center gap-2 rounded-md border border-warning/30 p-3">
              <BadgeCheck className="size-4 shrink-0 text-warning" />
              <p className="text-sm">
                {details.acr_values.split(" ").map(formatAcrValue).join(", ")}
              </p>
            </div>
          )}

          {/* Data requested — single section replacing profile fields + scopes + claims */}
          <RequestedClaimsSection scopes={scopes} />

          <VaultUnlockPanel
            active={vaultActive}
            authMode={authMode}
            disabled={state === "approving"}
            vault={vault}
            wallet={wallet}
          />

          {verificationMissing && (
            <Alert>
              <AlertTriangle className="size-4" />
              <AlertDescription>
                Complete identity verification first. The agent will be
                notified.
              </AlertDescription>
            </Alert>
          )}

          {missingIdentityFields.length > 0 && (
            <Alert>
              <AlertTriangle className="size-4" />
              <AlertDescription>
                Some requested data is not available in your profile:{" "}
                {missingIdentityFields.join(", ")}. If you continue, only the
                available data will be shared.
              </AlertDescription>
            </Alert>
          )}

          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <p className="text-muted-foreground text-sm">
            Expires in {formatTime(timeLeft)}
          </p>
        </CardContent>

        <CardFooter className="flex flex-col gap-3">
          <div className="flex w-full gap-3">
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
                verificationMissing ||
                (hasIdentityScopes &&
                  (vault.vaultState.status !== "loaded" ||
                    !vault.hasValidIdentityIntent ||
                    vault.intentLoading))
              }
              onClick={() => handleAction("authorize")}
            >
              {state === "approving" ? "Approving..." : "Approve"}
            </Button>
          </div>
        </CardFooter>
      </Card>
    </div>
  );
}
