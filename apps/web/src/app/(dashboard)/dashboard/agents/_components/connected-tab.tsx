"use client";

import type { LucideIcon } from "lucide-react";

import {
  Bot,
  ChevronDown,
  Code,
  CreditCard,
  Eye,
  KeyRound,
  Monitor,
  ShieldCheck,
  User,
} from "lucide-react";
import { useCallback, useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { Spinner } from "@/components/ui/spinner";
import {
  formatCapabilityName,
  formatConstraints,
  formatGrantSource,
  formatHostTier,
  formatUsageSummary,
} from "@/lib/agents/display";
import { trpcReact } from "@/lib/trpc/client";

function statusVariant(
  status: string
): "destructive" | "info" | "outline" | "success" | "warning" {
  switch (status) {
    case "active":
      return "success";
    case "expired":
      return "warning";
    case "revoked":
      return "destructive";
    case "pending":
      return "info";
    case "denied":
      return "destructive";
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
  return `${thumbprint.slice(0, 8)}...${thumbprint.slice(-8)}`;
}

const CAPABILITY_ICONS: Record<string, LucideIcon> = {
  check_compliance: ShieldCheck,
  my_profile: User,
  my_proofs: Eye,
  purchase: CreditCard,
  whoami: KeyRound,
};

function getCapabilityIcon(name: string): LucideIcon {
  return CAPABILITY_ICONS[name] ?? KeyRound;
}

const STATUS_PRIORITY: Record<string, number> = {
  active: 0,
  pending: 1,
  denied: 2,
  revoked: 3,
};

interface GrantRow {
  capabilityName: string;
  constraints?: unknown;
  id: string;
  source: string;
  status: string;
}

function deduplicateGrants(
  sessions: Array<{ grants: GrantRow[] }>
): GrantRow[] {
  const byCapability = new Map<string, GrantRow>();

  for (const session of sessions) {
    for (const grant of session.grants) {
      const existing = byCapability.get(grant.capabilityName);
      if (!existing) {
        byCapability.set(grant.capabilityName, grant);
        continue;
      }
      const existingPriority = STATUS_PRIORITY[existing.status] ?? 99;
      const newPriority = STATUS_PRIORITY[grant.status] ?? 99;
      if (newPriority < existingPriority) {
        byCapability.set(grant.capabilityName, grant);
      }
    }
  }

  return [...byCapability.values()];
}

export function ConnectedTab() {
  const utils = trpcReact.useUtils();
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const { data: hosts, isLoading } = trpcReact.agent.listHosts.useQuery();

  const revokeSession = trpcReact.agent.revokeSession.useMutation({
    onSuccess: async () => {
      await utils.agent.listHosts.invalidate();
    },
  });

  const updateGrant = trpcReact.agent.updateGrant.useMutation({
    onSuccess: async () => {
      await utils.agent.listHosts.invalidate();
    },
  });

  const handleRevokeSession = useCallback(
    async (sessionId: string) => {
      setPendingAction(`revoke-session-${sessionId}`);
      try {
        await revokeSession.mutateAsync({ sessionId });
      } finally {
        setPendingAction(null);
      }
    },
    [revokeSession]
  );

  const handleGrantAction = useCallback(
    async (grantId: string, status: "active" | "denied" | "revoked") => {
      setPendingAction(`grant-${grantId}`);
      try {
        await updateGrant.mutateAsync({ grantId, status });
      } finally {
        setPendingAction(null);
      }
    },
    [updateGrant]
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
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Bot />
          </EmptyMedia>
          <EmptyTitle>No agents connected</EmptyTitle>
          <EmptyDescription>
            When you authorize an agent to act on your behalf, it will appear
            here.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="space-y-3">
      {hosts.map((host) => {
        const totalUsage = host.sessions.reduce(
          (sum, s) => sum + s.usageToday,
          0
        );
        const uniqueGrants = deduplicateGrants(host.sessions);
        const totalGrants = uniqueGrants.length;
        const lastActive = host.sessions.reduce<string | null>((latest, s) => {
          if (!s.lastActiveAt) {
            return latest;
          }
          if (!latest) {
            return s.lastActiveAt;
          }
          return s.lastActiveAt > latest ? s.lastActiveAt : latest;
        }, null);

        return (
          <Collapsible key={host.id}>
            <Item variant="outline">
              <ItemMedia variant="icon">
                <Bot />
              </ItemMedia>
              <ItemContent>
                <ItemTitle>
                  {host.name}
                  <Badge
                    variant={
                      host.attestationTier === "attested"
                        ? "success"
                        : "outline"
                    }
                  >
                    {formatHostTier(host.attestationTier)}
                  </Badge>
                  <Badge variant={statusVariant(host.status)}>
                    {host.status}
                  </Badge>
                </ItemTitle>
                <ItemDescription>
                  {totalGrants}{" "}
                  {totalGrants === 1 ? "permission" : "permissions"} ·{" "}
                  {formatUsageSummary(totalUsage)} · Last active{" "}
                  {formatRelativeTime(lastActive)}
                </ItemDescription>
              </ItemContent>
              <ItemActions>
                <CollapsibleTrigger asChild>
                  <Button aria-label="Toggle details" size="sm" variant="ghost">
                    <ChevronDown className="size-4 transition-transform [[data-state=open]_&]:rotate-180" />
                  </Button>
                </CollapsibleTrigger>
              </ItemActions>
            </Item>

            <CollapsibleContent>
              <div className="space-y-4 rounded-b-lg border-x border-b p-4">
                {/* Permissions */}
                <div className="space-y-2">
                  <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wider">
                    Permissions
                  </h4>
                  {totalGrants === 0 ? (
                    <p className="text-muted-foreground text-sm">
                      No permissions granted
                    </p>
                  ) : (
                    <ItemGroup>
                      {uniqueGrants.map((grant) => {
                        const isActing = pendingAction === `grant-${grant.id}`;
                        const constraintText = formatConstraints(
                          grant.constraints
                        );
                        const CapIcon = getCapabilityIcon(grant.capabilityName);

                        return (
                          <Item key={grant.id} size="sm">
                            <ItemMedia variant="icon">
                              <CapIcon />
                            </ItemMedia>
                            <ItemContent>
                              <ItemTitle>
                                {formatCapabilityName(grant.capabilityName)}
                                <Badge
                                  className="text-xs"
                                  variant={statusVariant(grant.status)}
                                >
                                  {grant.status}
                                </Badge>
                              </ItemTitle>
                              <ItemDescription>
                                {formatGrantSource(grant.source)}
                                {constraintText ? ` · ${constraintText}` : ""}
                              </ItemDescription>
                            </ItemContent>
                            <ItemActions>
                              {grant.status === "pending" && (
                                <Button
                                  disabled={isActing}
                                  onClick={() =>
                                    handleGrantAction(grant.id, "active")
                                  }
                                  size="sm"
                                  variant="outline"
                                >
                                  {isActing && (
                                    <Spinner
                                      aria-hidden="true"
                                      className="mr-1"
                                      size="sm"
                                    />
                                  )}
                                  Approve
                                </Button>
                              )}
                              {grant.status === "active" && (
                                <AlertDialog>
                                  <AlertDialogTrigger asChild>
                                    <Button
                                      disabled={isActing}
                                      size="sm"
                                      variant="destructive"
                                    >
                                      Revoke
                                    </Button>
                                  </AlertDialogTrigger>
                                  <AlertDialogContent>
                                    <AlertDialogHeader>
                                      <AlertDialogTitle>
                                        Revoke "
                                        {formatCapabilityName(
                                          grant.capabilityName
                                        )}
                                        " permission?
                                      </AlertDialogTitle>
                                      <AlertDialogDescription>
                                        This agent will no longer be able to
                                        perform this action automatically.
                                      </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                      <AlertDialogCancel>
                                        Cancel
                                      </AlertDialogCancel>
                                      <AlertDialogAction
                                        onClick={() =>
                                          handleGrantAction(grant.id, "revoked")
                                        }
                                      >
                                        Revoke permission
                                      </AlertDialogAction>
                                    </AlertDialogFooter>
                                  </AlertDialogContent>
                                </AlertDialog>
                              )}
                            </ItemActions>
                          </Item>
                        );
                      })}
                    </ItemGroup>
                  )}
                </div>

                {/* Sessions */}
                <div className="space-y-2">
                  <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wider">
                    Connections
                  </h4>
                  {host.sessions.length === 0 ? (
                    <p className="text-muted-foreground text-sm">
                      No active connections
                    </p>
                  ) : (
                    <ItemGroup>
                      {host.sessions.map((session) => {
                        const isRevoking =
                          pendingAction === `revoke-session-${session.id}`;
                        const runtimeParts = [
                          session.runtime,
                          session.model,
                          session.version ? `v${session.version}` : null,
                        ]
                          .filter(Boolean)
                          .join(" · ");

                        return (
                          <Item key={session.id} size="sm">
                            <ItemMedia variant="icon">
                              <Monitor />
                            </ItemMedia>
                            <ItemContent>
                              <ItemTitle>
                                {session.displayName}
                                <Badge
                                  className="text-xs"
                                  variant={statusVariant(session.status)}
                                >
                                  {session.status}
                                </Badge>
                              </ItemTitle>
                              <ItemDescription>
                                {runtimeParts && `${runtimeParts} · `}
                                Last active{" "}
                                {formatRelativeTime(session.lastActiveAt)} ·{" "}
                                {formatUsageSummary(session.usageToday)}
                              </ItemDescription>
                            </ItemContent>
                            <ItemActions>
                              {session.status === "active" && (
                                <AlertDialog>
                                  <AlertDialogTrigger asChild>
                                    <Button
                                      disabled={isRevoking}
                                      size="sm"
                                      variant="destructive"
                                    >
                                      {isRevoking && (
                                        <Spinner
                                          aria-hidden="true"
                                          className="mr-1"
                                          size="sm"
                                        />
                                      )}
                                      Revoke access
                                    </Button>
                                  </AlertDialogTrigger>
                                  <AlertDialogContent>
                                    <AlertDialogHeader>
                                      <AlertDialogTitle>
                                        Revoke access for {session.displayName}?
                                      </AlertDialogTitle>
                                      <AlertDialogDescription>
                                        This will disconnect the agent session
                                        and revoke all its permissions.
                                      </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                      <AlertDialogCancel>
                                        Cancel
                                      </AlertDialogCancel>
                                      <AlertDialogAction
                                        onClick={() =>
                                          handleRevokeSession(session.id)
                                        }
                                      >
                                        Revoke access
                                      </AlertDialogAction>
                                    </AlertDialogFooter>
                                  </AlertDialogContent>
                                </AlertDialog>
                              )}
                            </ItemActions>
                          </Item>
                        );
                      })}
                    </ItemGroup>
                  )}
                </div>

                {/* Technical details (Level 3) */}
                <Collapsible>
                  <CollapsibleTrigger asChild>
                    <Button
                      className="gap-1.5 text-muted-foreground"
                      size="sm"
                      variant="ghost"
                    >
                      <Code className="size-3.5" />
                      Technical details
                      <ChevronDown className="size-3.5 transition-transform [[data-state=open]_&]:rotate-180" />
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="mt-2 space-y-3 rounded-md border p-3 font-mono text-xs">
                      <div>
                        <span className="text-muted-foreground">Host ID: </span>
                        {host.id}
                      </div>
                      <div>
                        <span className="text-muted-foreground">
                          Public key:{" "}
                        </span>
                        {truncateThumbprint(host.publicKeyThumbprint)}
                      </div>
                      {host.attestationProvider && (
                        <div>
                          <span className="text-muted-foreground">
                            Verified by:{" "}
                          </span>
                          {host.attestationProvider}
                        </div>
                      )}
                      <div>
                        <span className="text-muted-foreground">
                          Registered:{" "}
                        </span>
                        {new Date(host.createdAt).toLocaleString()}
                      </div>
                      {host.sessions.map((session) => (
                        <div
                          className="border-t pt-2"
                          key={`tech-${session.id}`}
                        >
                          <div>
                            <span className="text-muted-foreground">
                              Session:{" "}
                            </span>
                            {session.displayName}
                          </div>
                          <div>
                            <span className="text-muted-foreground">ID: </span>
                            {session.id}
                          </div>
                          <div>
                            <span className="text-muted-foreground">
                              Idle timeout:{" "}
                            </span>
                            {formatRemainingTime(session.idleExpiresAt)}
                          </div>
                          <div>
                            <span className="text-muted-foreground">
                              Max lifetime:{" "}
                            </span>
                            {formatRemainingTime(session.maxExpiresAt)}
                          </div>
                          {session.grants.some((g) => g.constraints) && (
                            <div className="mt-1">
                              <span className="text-muted-foreground">
                                Raw constraints:
                              </span>
                              <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all text-xs">
                                {JSON.stringify(
                                  session.grants
                                    .filter((g) => g.constraints)
                                    .map((g) => ({
                                      capability: g.capabilityName,
                                      constraints: g.constraints,
                                    })),
                                  null,
                                  2
                                )}
                              </pre>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              </div>
            </CollapsibleContent>
          </Collapsible>
        );
      })}
    </div>
  );
}
