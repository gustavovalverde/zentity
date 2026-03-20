"use client";

import type { AuthMode } from "@/lib/auth/detect-auth-mode";
import type { AgentClaims } from "@/lib/identity/agent-claims";

import {
  AlertTriangle,
  Bot,
  ChevronDown,
  ChevronUp,
  ShieldCheck,
  ShieldPlus,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

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
  fetchIntentFromEndpoint,
  useVaultUnlock,
} from "@/components/vault-unlock/use-vault-unlock";
import {
  buildIdentityPayload,
  buildScopeKey,
} from "@/components/vault-unlock/vault-unlock";
import { VaultUnlockPanel } from "@/components/vault-unlock/vault-unlock-panel";
import { isIdentityScope } from "@/lib/auth/oidc/identity-scopes";

interface AuthorizationDetail {
  amount?: { currency?: string; value?: string };
  item?: string;
  merchant?: string;
  type?: string;
  [key: string]: unknown;
}

function buildPolicyLink(
  details: CibaRequestDetails,
  clientId: string | undefined
): string {
  const params = new URLSearchParams();
  if (clientId) {
    params.set("clientId", clientId);
  }
  if (details.authorization_details?.some((d) => d.type === "purchase")) {
    params.set("type", "purchase");
    const purchase = details.authorization_details.find(
      (d) => d.type === "purchase"
    );
    if (purchase?.amount?.value) {
      params.set("maxAmount", purchase.amount.value);
    }
    if (purchase?.amount?.currency) {
      params.set("currency", purchase.amount.currency);
    }
  } else {
    params.set("type", "scope");
    const scopes = details.scope
      .split(" ")
      .filter((s) => s !== "openid")
      .join(",");
    params.set("scopes", scopes);
  }
  return `/dashboard/agent-policies?create=true&${params.toString()}`;
}

interface CibaRequestDetails {
  acr_values?: string;
  agent_claims?: AgentClaims;
  auth_req_id: string;
  authorization_details?: AuthorizationDetail[];
  binding_message?: string;
  client_id?: string;
  client_name?: string;
  expires_at: string;
  scope: string;
  status: string;
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

interface AttestationInfo {
  provider?: string;
  verified?: boolean;
}

function AgentIdentityCard({ claims }: Readonly<{ claims: AgentClaims }>) {
  const [showAudit, setShowAudit] = useState(false);
  const agent = claims.agent;
  if (!agent?.name) {
    return null;
  }

  const attestation = (claims as Record<string, unknown>).attestation as
    | AttestationInfo
    | undefined;
  const isVerified = attestation?.verified === true;

  const capabilities =
    agent.capabilities ?? claims.capabilities?.map((c) => c.action);
  const oversightItems = claims.oversight?.requires_human_approval_for;
  const delegationDepth = claims.delegation?.depth;
  const traceId = claims.audit?.trace_id;

  return (
    <div className="space-y-2 rounded-lg border bg-muted/50 p-4">
      <div className="flex items-center gap-2">
        <Bot className="size-4 text-muted-foreground" />
        <p className="font-semibold text-muted-foreground text-xs uppercase tracking-wider">
          Agent
        </p>
        {isVerified ? (
          <Badge className="border-green-200 bg-green-50 text-green-700 text-xs dark:border-green-800 dark:bg-green-950 dark:text-green-300">
            Verified by {attestation?.provider ?? "Provider"}
          </Badge>
        ) : (
          <Badge className="text-xs" variant="outline">
            Unverified
          </Badge>
        )}
        {delegationDepth != null && delegationDepth > 0 && (
          <Badge className="text-xs" variant="secondary">
            Delegated (depth: {delegationDepth})
          </Badge>
        )}
      </div>
      <p className="font-medium">{agent.name}</p>
      {(agent.model || agent.runtime || agent.version) && (
        <p className="text-muted-foreground text-sm">
          {[agent.model, agent.runtime, agent.version]
            .filter(Boolean)
            .join(" / ")}
        </p>
      )}
      {claims.task?.description && (
        <p className="text-muted-foreground text-sm">
          {claims.task.description}
        </p>
      )}
      {capabilities && capabilities.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {capabilities.map((cap) => (
            <Badge className="text-xs" key={cap} variant="secondary">
              {cap}
            </Badge>
          ))}
        </div>
      )}
      {oversightItems && oversightItems.length > 0 && (
        <div>
          <p className="text-muted-foreground text-xs">
            Requires human approval for:
          </p>
          <ul className="mt-0.5 space-y-0.5 pl-4 text-muted-foreground text-xs">
            {oversightItems.map((item) => (
              <li className="list-disc" key={item}>
                {item}
              </li>
            ))}
          </ul>
        </div>
      )}
      {traceId && (
        <div>
          <button
            className="flex items-center gap-1 text-muted-foreground text-xs hover:text-foreground"
            onClick={() => setShowAudit((p) => !p)}
            type="button"
          >
            Audit
            {showAudit ? (
              <ChevronUp className="size-3" />
            ) : (
              <ChevronDown className="size-3" />
            )}
          </button>
          {showAudit && (
            <p className="mt-1 break-all font-mono text-muted-foreground text-xs">
              trace: {traceId}
              {claims.audit?.session_id && (
                <>
                  <br />
                  session: {claims.audit.session_id}
                </>
              )}
            </p>
          )}
        </div>
      )}
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

export function CibaApproveClient({
  agentClaims: serverAgentClaims,
  authMode,
  authReqId,
  clientId: serverClientId,
  wallet,
}: Readonly<{
  agentClaims?: AgentClaims | null;
  authMode: AuthMode;
  authReqId: string | null;
  clientId?: string;
  wallet: { address: string; chainId: number } | null;
}>) {
  const router = useRouter();

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

  const vault = useVaultUnlock({
    logTag: "ciba-approve",
    scopeKey,
    active: vaultActive,
    fetchIntentToken,
  });

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
      clearIntent();
      throw new Error(body?.error || "Unable to stage identity claims.");
    }
    if (!body?.staged) {
      clearIntent();
      throw new Error("Identity claims were not staged.");
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
            throw new Error("Unlock your identity vault before approving.");
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

          {serverAgentClaims || details?.agent_claims ? (
            <AgentIdentityCard
              claims={
                (serverAgentClaims ?? details?.agent_claims) as AgentClaims
              }
            />
          ) : (
            details && (
              <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
                <p className="text-sm">
                  No agent identity provided — this application has not
                  disclosed what AI agent is acting on its behalf.
                </p>
              </div>
            )
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

          {details?.acr_values && (
            <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950">
              <ShieldCheck className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <p className="text-sm">
                <span className="font-medium">Required assurance:</span>{" "}
                {details.acr_values
                  .split(" ")
                  .map((v) => v.replace("urn:zentity:assurance:", ""))
                  .join(", ")}
              </p>
            </div>
          )}

          <VaultUnlockPanel
            active={vaultActive}
            authMode={authMode}
            disabled={state === "approving"}
            vault={vault}
            wallet={wallet}
          />

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
          {!hasIdentityScopes && details && (
            <Button asChild size="sm" variant="outline">
              <Link
                href={buildPolicyLink(
                  details,
                  serverClientId ?? details.client_id
                )}
              >
                <ShieldPlus className="mr-2 size-4" />
                Always allow this
              </Link>
            </Button>
          )}
        </CardFooter>
      </Card>
    </div>
  );
}
