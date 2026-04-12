"use client";

import { BadgeCheck, Bot, Mail, MessageSquare } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { SCOPE_DESCRIPTIONS } from "@/lib/auth/oidc/disclosure-registry";

import { PushNotificationBanner } from "./push-banner";
import { PwaInstallBanner } from "./pwa-install-banner";

interface CibaRequest {
  approvalMethod: string | null;
  attestationTier: string | null;
  authorizationDetails: string | null;
  authReqId: string;
  bindingMessage: string | null;
  clientName: string | null;
  createdAt: Date;
  displayName: string | null;
  expiresAt: Date;
  model: string | null;
  runtime: string | null;
  scope: string;
  status: string;
}

interface RequestsTabProps {
  readonly mailpitUrl: string | null;
  readonly onSelect: (authReqId: string) => void;
  readonly requests: CibaRequest[];
}

function statusVariant(
  status: string
): "destructive" | "outline" | "secondary" | "success" {
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

function formatScopeDescription(scope: string): string {
  return scope
    .split(" ")
    .filter((s) => s !== "openid")
    .map((s) => SCOPE_DESCRIPTIONS[s] ?? s)
    .join(", ");
}

function formatPurchaseDetail(
  authorizationDetails: string | null
): string | null {
  if (!authorizationDetails) {
    return null;
  }
  try {
    const details = JSON.parse(authorizationDetails) as Array<{
      amount?: { currency?: string; value?: string };
      type?: string;
    }>;
    if (!Array.isArray(details)) {
      return null;
    }

    for (const d of details) {
      if (d.type === "purchase" && d.amount?.value) {
        return `Purchase: $${d.amount.value} ${d.amount.currency ?? "USD"}`;
      }
    }
    return null;
  } catch {
    return null;
  }
}

export function RequestsTab({
  requests,
  mailpitUrl,
  onSelect,
}: RequestsTabProps) {
  return (
    <div className="space-y-6">
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
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <MessageSquare />
            </EmptyMedia>
            <EmptyTitle>No agent requests yet</EmptyTitle>
            <EmptyDescription>
              When an application or agent needs your approval, it will appear
              here.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ItemGroup>
          {requests.map((req) => {
            const expired = isExpired(req.expiresAt, req.status);
            const displayStatus = expired ? "expired" : req.status;
            const isAttested = req.attestationTier === "attested";
            const isAutoApproved =
              req.approvalMethod === "capability_grant" ||
              req.approvalMethod === "boundary";
            const purchaseDetail = formatPurchaseDetail(
              req.authorizationDetails
            );
            const scopeText = formatScopeDescription(req.scope);

            return (
              <li key={req.authReqId}>
                <Item asChild variant="outline">
                  <button
                    className="w-full text-left"
                    onClick={() => onSelect(req.authReqId)}
                    type="button"
                  >
                    <ItemMedia variant="icon">
                      <Bot />
                    </ItemMedia>
                    <ItemContent>
                      <ItemTitle>
                        {req.clientName ?? "Unknown Application"}
                        {req.displayName && (
                          <span className="font-normal text-muted-foreground text-xs">
                            via {req.displayName}
                          </span>
                        )}
                      </ItemTitle>
                      <ItemDescription>
                        {req.bindingMessage ?? scopeText}
                      </ItemDescription>
                      {purchaseDetail && (
                        <p className="font-medium text-sm">{purchaseDetail}</p>
                      )}
                    </ItemContent>
                    <div className="flex shrink-0 items-center gap-2">
                      {isAttested && (
                        <Badge className="text-xs" variant="info">
                          Verified
                        </Badge>
                      )}
                      {isAutoApproved && (
                        <Badge className="gap-1" variant="secondary">
                          <BadgeCheck className="size-3" />
                          Auto-approved
                        </Badge>
                      )}
                      <Badge variant={statusVariant(displayStatus)}>
                        {displayStatus.charAt(0).toUpperCase() +
                          displayStatus.slice(1)}
                      </Badge>
                    </div>
                  </button>
                </Item>
              </li>
            );
          })}
        </ItemGroup>
      )}
    </div>
  );
}
