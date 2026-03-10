"use client";

import type { AuthMode } from "@/lib/auth/detect-auth-mode";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

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

type PageState =
  | "loading"
  | "ready"
  | "approving"
  | "rejecting"
  | "approved"
  | "rejected"
  | "expired"
  | "error";

export function CibaApproveClient({
  authMode: _authMode,
  wallet: _wallet,
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

  // Countdown timer
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

  const handleAction = useCallback(
    async (action: "authorize" | "reject") => {
      if (!authReqId) {
        return;
      }

      setState(action === "authorize" ? "approving" : "rejecting");

      try {
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
        setState("error");
      }
    },
    [authReqId]
  );

  const scopes = details?.scope.split(" ").filter((s) => s !== "openid") ?? [];

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

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
          {scopes.length > 0 && (
            <div>
              <p className="mb-2 font-medium text-sm">Requested scopes</p>
              <div className="flex flex-wrap gap-2">
                {scopes.map((scope) => (
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

          <p className="text-muted-foreground text-sm">
            Expires in {formatTime(timeLeft)}
          </p>
        </CardContent>

        <CardFooter className="flex gap-3">
          <Button
            className="flex-1"
            disabled={state === "approving" || state === "rejecting"}
            onClick={() => handleAction("reject")}
            variant="outline"
          >
            {state === "rejecting" ? "Denying..." : "Deny"}
          </Button>
          <Button
            className="flex-1"
            disabled={state === "approving" || state === "rejecting"}
            onClick={() => handleAction("authorize")}
          >
            {state === "approving" ? "Approving..." : "Approve"}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
