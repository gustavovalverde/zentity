"use client";

import { AppWindow, ExternalLink } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

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
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { Spinner } from "@/components/ui/spinner";
import { authClient } from "@/lib/auth/auth-client";
import {
  groupScopes,
  HIDDEN_SCOPES,
  SCOPE_DESCRIPTIONS,
} from "@/lib/auth/oidc/scope-display";

export interface ConsentRow {
  consentId: string;
  clientId: string;
  scopes: unknown;
  createdAt: Date | null;
  updatedAt: Date | null;
  clientName: string | null;
  clientIcon: string | null;
  clientUri: string | null;
}

function formatDate(date: Date | null): string {
  if (!date) {
    return "Unknown date";
  }
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function parseScopes(scopes: unknown): string[] {
  if (Array.isArray(scopes)) {
    return scopes.filter((s) => typeof s === "string");
  }
  if (typeof scopes === "string") {
    return scopes.split(" ").filter(Boolean);
  }
  return [];
}

function AppLetter({ name }: { name: string }) {
  return (
    <span className="font-semibold text-sm">
      {(name[0] ?? "?").toUpperCase()}
    </span>
  );
}

export function ConnectedAppsCard({
  consents,
}: Readonly<{ consents: ConsentRow[] }>) {
  const router = useRouter();
  const [revoking, setRevoking] = useState<string | null>(null);
  const [optimisticRemoved, setOptimisticRemoved] = useState<Set<string>>(
    new Set()
  );
  const [error, setError] = useState<string | null>(null);

  const visible = consents.filter((c) => !optimisticRemoved.has(c.consentId));

  const handleRevoke = async (consentId: string) => {
    setRevoking(consentId);
    setError(null);
    setOptimisticRemoved((prev) => new Set(prev).add(consentId));

    try {
      const result = await authClient.oauth2.deleteConsent({ id: consentId });
      if (result.error) {
        throw new Error(result.error.message ?? "Failed to revoke access");
      }
      router.refresh();
    } catch (err) {
      setOptimisticRemoved((prev) => {
        const next = new Set(prev);
        next.delete(consentId);
        return next;
      });
      setError(err instanceof Error ? err.message : "Failed to revoke access");
    } finally {
      setRevoking(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Connected Apps</CardTitle>
        <CardDescription>
          Apps you've authorized to access your Zentity account
        </CardDescription>
      </CardHeader>
      <CardContent>
        {error && <p className="mb-4 text-destructive text-sm">{error}</p>}
        {visible.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <AppWindow />
              </EmptyMedia>
              <EmptyTitle>No connected apps</EmptyTitle>
              <EmptyDescription>
                When you authorize apps via Zentity, they'll appear here.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ItemGroup>
            {visible.map((consent) => {
              const name = consent.clientName ?? consent.clientId;
              const scopes = parseScopes(consent.scopes);
              const visibleScopes = scopes.filter((s) => !HIDDEN_SCOPES.has(s));
              const groups = groupScopes(visibleScopes);
              const isRevoking = revoking === consent.consentId;

              return (
                <Item key={consent.consentId} variant="outline">
                  <ItemMedia variant="icon">
                    {consent.clientIcon ? (
                      // biome-ignore lint/performance/noImgElement lint/correctness/useImageSize: external client icon URL, dimensions set via CSS
                      <img
                        alt={name}
                        className="size-full rounded-full object-cover"
                        src={consent.clientIcon}
                      />
                    ) : (
                      <AppLetter name={name} />
                    )}
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle className="flex items-center gap-2">
                      {name}
                      {consent.clientUri && (
                        <a
                          className="text-muted-foreground hover:text-foreground"
                          href={consent.clientUri}
                          rel="noopener noreferrer"
                          target="_blank"
                        >
                          <ExternalLink className="size-3" />
                        </a>
                      )}
                    </ItemTitle>
                    <p className="text-muted-foreground text-xs">
                      Authorized {formatDate(consent.createdAt)}
                      {consent.updatedAt &&
                      consent.updatedAt > (consent.createdAt ?? new Date(0))
                        ? ` · Updated ${formatDate(consent.updatedAt)}`
                        : ""}
                    </p>
                    {groups.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {groups.map((group) => (
                          <Badge
                            key={group.label}
                            variant={
                              group.label === "Personal information"
                                ? "outline"
                                : "secondary"
                            }
                          >
                            {group.label}
                            {group.label === "Personal information" &&
                              " · Shares personal data"}
                          </Badge>
                        ))}
                        {visibleScopes.length > 0 && (
                          <span className="text-muted-foreground text-xs leading-5">
                            {visibleScopes
                              .map((s) => SCOPE_DESCRIPTIONS[s] ?? s)
                              .join(", ")}
                          </span>
                        )}
                      </div>
                    )}
                  </ItemContent>
                  <ItemActions>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          disabled={isRevoking}
                          size="sm"
                          variant="destructive"
                        >
                          {isRevoking ? (
                            <Spinner
                              aria-hidden="true"
                              className="mr-1"
                              size="sm"
                            />
                          ) : null}
                          Revoke
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>
                            Revoke access for {name}?
                          </AlertDialogTitle>
                          <AlertDialogDescription>
                            This app will no longer be able to access your
                            account. You can re-authorize it later.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => handleRevoke(consent.consentId)}
                          >
                            Revoke access
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </ItemActions>
                </Item>
              );
            })}
          </ItemGroup>
        )}
      </CardContent>
    </Card>
  );
}
