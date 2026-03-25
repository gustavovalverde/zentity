"use client";

import { Bot, Fingerprint, Shield, ShieldOff } from "lucide-react";
import { useCallback, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { trpcReact } from "@/lib/trpc/client";

function statusVariant(
  status: string
): "success" | "warning" | "destructive" | "info" | "outline" {
  switch (status) {
    case "active":
      return "success";
    case "expired":
      return "warning";
    case "revoked":
      return "destructive";
    case "attested":
      return "info";
    default:
      return "outline";
  }
}

function formatRelativeTime(iso: string | null): string {
  if (!iso) {
    return "Never";
  }

  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) {
    return "Just now";
  }
  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }

  return `${Math.floor(hours / 24)}d ago`;
}

function formatRemainingTime(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) {
    return "expired";
  }

  const minutes = Math.ceil(diff / 60_000);
  if (minutes < 60) {
    return `${minutes}m`;
  }

  const hours = Math.ceil(minutes / 60);
  if (hours < 24) {
    return `${hours}h`;
  }

  return `${Math.ceil(hours / 24)}d`;
}

function truncateThumbprint(thumbprint: string): string {
  if (thumbprint.length <= 18) {
    return thumbprint;
  }

  return `${thumbprint.slice(0, 8)}…${thumbprint.slice(-8)}`;
}

export function AgentsDashboardClient() {
  const utils = trpcReact.useUtils();
  const [pendingSessionId, setPendingSessionId] = useState<string | null>(null);
  const { data: hosts, isLoading } = trpcReact.agent.listHosts.useQuery();
  const revokeSession = trpcReact.agent.revokeSession.useMutation({
    onSuccess: async () => {
      await utils.agent.listHosts.invalidate();
    },
  });

  const handleRevoke = useCallback(
    async (sessionId: string) => {
      setPendingSessionId(sessionId);
      try {
        await revokeSession.mutateAsync({ sessionId });
      } finally {
        setPendingSessionId(null);
      }
    },
    [revokeSession]
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner className="size-8" />
      </div>
    );
  }

  if (!hosts || hosts.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>No agents registered</CardTitle>
          <CardDescription>
            When MCP tools connect with your account, their hosts and live
            sessions will appear here.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {hosts.map((host) => (
        <Card key={host.id}>
          <CardHeader className="pb-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Bot className="size-4 text-muted-foreground" />
                  <CardTitle className="text-base">{host.name}</CardTitle>
                  <Badge variant={statusVariant(host.status)}>
                    {host.status}
                  </Badge>
                  <Badge variant={statusVariant(host.attestationTier)}>
                    {host.attestationTier}
                  </Badge>
                </div>
                <CardDescription className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                  <span>{host.sessionCount} live/runtime sessions</span>
                  <span className="inline-flex items-center gap-1">
                    <Fingerprint className="size-3" />
                    {truncateThumbprint(host.publicKeyThumbprint)}
                  </span>
                  <span>Registered {formatRelativeTime(host.createdAt)}</span>
                </CardDescription>
              </div>
              {host.attestationProvider ? (
                <p className="text-muted-foreground text-xs">
                  Verified by {host.attestationProvider}
                </p>
              ) : null}
            </div>
          </CardHeader>
          <CardContent>
            {host.sessions.length > 0 ? (
              <div className="space-y-3">
                {host.sessions.map((session) => {
                  const revoking = pendingSessionId === session.id;

                  return (
                    <div
                      className="rounded-lg border bg-muted/20 p-4"
                      key={session.id}
                    >
                      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium text-sm">
                              {session.displayName}
                            </span>
                            <Badge variant={statusVariant(session.status)}>
                              {session.status}
                            </Badge>
                            {session.runtime ? (
                              <span className="text-muted-foreground text-xs">
                                {session.runtime}
                                {session.model ? ` · ${session.model}` : ""}
                                {session.version
                                  ? ` · v${session.version}`
                                  : ""}
                              </span>
                            ) : null}
                          </div>
                          <p className="text-muted-foreground text-xs">
                            {session.id} · Last active{" "}
                            {formatRelativeTime(session.lastActiveAt)} ·{" "}
                            {session.usageToday} actions today
                          </p>
                          <p className="text-muted-foreground text-xs">
                            Idle window{" "}
                            {formatRemainingTime(session.idleExpiresAt)} · Max
                            lifetime {formatRemainingTime(session.maxExpiresAt)}
                          </p>
                        </div>
                        {session.status === "active" ? (
                          <Button
                            disabled={revoking}
                            onClick={() => handleRevoke(session.id)}
                            size="sm"
                            variant="destructive"
                          >
                            {revoking ? (
                              <Spinner className="mr-1.5 size-3.5" />
                            ) : (
                              <ShieldOff className="mr-1.5 size-3.5" />
                            )}
                            Revoke session
                          </Button>
                        ) : null}
                      </div>

                      <div className="mt-4 space-y-2">
                        <p className="font-medium text-muted-foreground text-xs uppercase tracking-wider">
                          Session Grants
                        </p>
                        {session.grants.length > 0 ? (
                          <div className="grid gap-2">
                            {session.grants.map((grant) => (
                              <div
                                className="flex flex-col gap-2 rounded-md border bg-background px-3 py-2 md:flex-row md:items-center md:justify-between"
                                key={grant.id}
                              >
                                <div className="flex flex-wrap items-center gap-2">
                                  <Shield className="size-3.5 text-muted-foreground" />
                                  <span className="font-medium text-sm">
                                    {grant.capabilityName}
                                  </span>
                                  <Badge
                                    className="text-xs"
                                    variant={statusVariant(grant.status)}
                                  >
                                    {grant.status}
                                  </Badge>
                                  <span className="text-muted-foreground text-xs">
                                    {grant.source}
                                  </span>
                                </div>
                                {grant.constraints ? (
                                  <span className="font-mono text-muted-foreground text-xs">
                                    {JSON.stringify(grant.constraints).slice(
                                      0,
                                      72
                                    )}
                                    {JSON.stringify(grant.constraints).length >
                                    72
                                      ? "..."
                                      : ""}
                                  </span>
                                ) : (
                                  <span className="text-muted-foreground text-xs">
                                    No constraints
                                  </span>
                                )}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-muted-foreground text-sm">
                            No capability grants
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-muted-foreground text-sm">
                No active or historical sessions under this host yet.
              </p>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
