import { desc, eq } from "drizzle-orm";
import { BadgeCheck, Bot, Mail } from "lucide-react";
import { headers } from "next/headers";
import Link from "next/link";

import { PageHeader } from "@/components/layouts/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { env } from "@/env";
import { getCachedSession } from "@/lib/auth/cached-session";
import { db } from "@/lib/db/connection";
import { cibaRequests } from "@/lib/db/schema/ciba";
import { oauthClients } from "@/lib/db/schema/oauth-provider";

import { CibaLiveUpdater } from "./_components/live-updater";
import { PushNotificationBanner } from "./_components/push-banner";
import { PwaInstallBanner } from "./_components/pwa-install-banner";

function statusVariant(
  status: string
): "success" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "approved":
      return "success";
    case "rejected":
      return "destructive";
    case "pending":
      return "secondary";
    default:
      return "outline";
  }
}

function isExpired(expiresAt: Date, status: string): boolean {
  return status === "pending" && expiresAt < new Date();
}

function resolveLocalMailpitUrl(): string | null {
  try {
    const appUrl = new URL(env.NEXT_PUBLIC_APP_URL);
    const isLocalHost =
      appUrl.hostname === "localhost" ||
      appUrl.hostname === "127.0.0.1" ||
      appUrl.hostname === "::1" ||
      appUrl.hostname === "[::1]";

    if (!isLocalHost) {
      return null;
    }

    return `http://${appUrl.hostname === "[::1]" ? "[::1]" : appUrl.hostname}:8025`;
  } catch {
    return null;
  }
}

export default async function CibaListPage() {
  const headersObj = await headers();
  const session = await getCachedSession(headersObj);
  if (!session) {
    return null;
  }

  const mailpitUrl =
    process.env.NODE_ENV === "production" ? null : resolveLocalMailpitUrl();

  const requests = await db
    .select({
      displayName: cibaRequests.displayName,
      model: cibaRequests.model,
      runtime: cibaRequests.runtime,
      attestationTier: cibaRequests.attestationTier,
      authReqId: cibaRequests.authReqId,
      scope: cibaRequests.scope,
      bindingMessage: cibaRequests.bindingMessage,
      authorizationDetails: cibaRequests.authorizationDetails,
      status: cibaRequests.status,
      approvalMethod: cibaRequests.approvalMethod,
      expiresAt: cibaRequests.expiresAt,
      createdAt: cibaRequests.createdAt,
      clientName: oauthClients.name,
    })
    .from(cibaRequests)
    .leftJoin(oauthClients, eq(cibaRequests.clientId, oauthClients.clientId))
    .where(eq(cibaRequests.userId, session.user.id))
    .orderBy(desc(cibaRequests.createdAt))
    .limit(50);

  return (
    <div className="space-y-6">
      <CibaLiveUpdater />
      <PageHeader
        description="Applications requesting access to your account via backchannel authentication (CIBA)."
        title="Agent Requests"
      />

      <PushNotificationBanner />
      <PwaInstallBanner />
      {mailpitUrl && (
        <Alert variant="info">
          <Mail />
          <AlertTitle>Local notification behavior</AlertTitle>
          <AlertDescription>
            Approval emails are captured in{" "}
            <a
              className="underline"
              href={mailpitUrl}
              rel="noreferrer"
              target="_blank"
            >
              Mailpit
            </a>{" "}
            during local development instead of being delivered to your real
            inbox. Push notifications are per-device, so enable them separately
            anywhere you want approval alerts.
          </AlertDescription>
        </Alert>
      )}

      {requests.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            No agent authorization requests yet.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {requests.map((req) => {
            const expired = isExpired(req.expiresAt, req.status);
            const displayStatus = expired ? "expired" : req.status;
            const agentInfo =
              req.displayName == null
                ? null
                : {
                    name: req.displayName,
                    trustTier: req.attestationTier ?? "unverified",
                    model: req.model,
                    runtime: req.runtime,
                  };

            return (
              <Link
                className="block"
                href={`/dashboard/ciba/approve?auth_req_id=${encodeURIComponent(req.authReqId)}`}
                key={req.authReqId}
              >
                <Card className="transition-colors hover:bg-muted/50">
                  <CardHeader className="pb-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <CardTitle className="text-base">
                          {req.clientName ?? "Unknown Application"}
                        </CardTitle>
                        {agentInfo && (
                          <span className="flex items-center gap-1 text-muted-foreground text-sm">
                            <Bot className="size-3" />
                            {agentInfo.name}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {agentInfo && agentInfo.trustTier === "attested" && (
                          <Badge className="text-xs" variant="info">
                            Attested
                          </Badge>
                        )}
                        {(req.approvalMethod === "capability_grant" ||
                          req.approvalMethod === "boundary") && (
                          <Badge className="gap-1" variant="secondary">
                            <BadgeCheck className="size-3" />
                            Auto-approved
                          </Badge>
                        )}
                        <Badge variant={statusVariant(displayStatus)}>
                          {displayStatus}
                        </Badge>
                      </div>
                    </div>
                    <CardDescription>
                      {req.scope
                        .split(" ")
                        .filter((s) => s !== "openid")
                        .join(", ")}
                    </CardDescription>
                  </CardHeader>
                  {(req.bindingMessage || req.authorizationDetails) && (
                    <CardContent className="pt-0">
                      {req.bindingMessage && (
                        <p className="text-muted-foreground text-sm">
                          {req.bindingMessage}
                        </p>
                      )}
                      {req.authorizationDetails &&
                        (() => {
                          try {
                            const details = JSON.parse(
                              req.authorizationDetails
                            ) as Array<{
                              type?: string;
                              item?: string;
                              amount?: {
                                currency?: string;
                                value?: string;
                              };
                            }>;
                            if (!Array.isArray(details)) {
                              return null;
                            }
                            return details.map((d) => {
                              if (d.type === "purchase" && d.amount?.value) {
                                return (
                                  <p
                                    className="mt-1 font-medium text-sm"
                                    key={`ad-${d.type}-${d.amount.value}`}
                                  >
                                    Purchase: ${d.amount.value}{" "}
                                    {d.amount.currency ?? "USD"}
                                  </p>
                                );
                              }
                              if (d.type) {
                                return (
                                  <p
                                    className="mt-1 text-muted-foreground text-sm"
                                    key={`ad-${d.type}`}
                                  >
                                    {d.type}
                                  </p>
                                );
                              }
                              return null;
                            });
                          } catch {
                            return null;
                          }
                        })()}
                    </CardContent>
                  )}
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
