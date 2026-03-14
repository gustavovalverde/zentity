import { desc, eq } from "drizzle-orm";
import { headers } from "next/headers";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getCachedSession } from "@/lib/auth/cached-session";
import { db } from "@/lib/db/connection";
import { cibaRequests } from "@/lib/db/schema/ciba";
import { oauthClients } from "@/lib/db/schema/oauth-provider";

import { PushNotificationBanner } from "./_components/push-banner";

function statusVariant(
  status: string
): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "approved":
      return "default";
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

export default async function CibaListPage() {
  const headersObj = await headers();
  const session = await getCachedSession(headersObj);
  if (!session) {
    return null;
  }

  const requests = await db
    .select({
      authReqId: cibaRequests.authReqId,
      scope: cibaRequests.scope,
      bindingMessage: cibaRequests.bindingMessage,
      authorizationDetails: cibaRequests.authorizationDetails,
      status: cibaRequests.status,
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
      <div>
        <h1 className="font-bold text-2xl tracking-tight">Agent Requests</h1>
        <p className="text-muted-foreground">
          Applications requesting access to your account via backchannel
          authentication (CIBA).
        </p>
      </div>

      <PushNotificationBanner />

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

            return (
              <Link
                className="block"
                href={`/dashboard/ciba/approve?auth_req_id=${encodeURIComponent(req.authReqId)}`}
                key={req.authReqId}
              >
                <Card className="transition-colors hover:bg-muted/50">
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base">
                        {req.clientName ?? "Unknown Application"}
                      </CardTitle>
                      <Badge variant={statusVariant(displayStatus)}>
                        {displayStatus}
                      </Badge>
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
