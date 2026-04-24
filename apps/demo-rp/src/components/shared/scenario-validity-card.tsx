"use client";

import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { ScenarioValidityState, ValidityStatus } from "@/lib/validity";
import type { RouteScenarioId } from "@/scenarios/route-scenario-registry";

function formatStatusLabel(status: ValidityStatus | null | undefined): string {
  switch (status) {
    case "verified":
      return "Verified";
    case "revoked":
      return "Revoked";
    case "stale":
      return "Stale";
    case "failed":
      return "Failed";
    case "pending":
      return "Pending";
    default:
      return "Unknown";
  }
}

function getBadgeVariant(
  status: ValidityStatus | null | undefined
): "default" | "destructive" | "outline" | "secondary" {
  switch (status) {
    case "verified":
      return "default";
    case "revoked":
      return "destructive";
    case "stale":
      return "secondary";
    default:
      return "outline";
  }
}

async function fetchValidityState(
  scenarioId: RouteScenarioId
): Promise<ScenarioValidityState> {
  const response = await fetch(
    `/api/auth/validity-state?scenarioId=${encodeURIComponent(scenarioId)}`
  );
  const body = (await response.json().catch(() => null)) as
    | ScenarioValidityState
    | { error?: string }
    | null;

  if (!response.ok) {
    const message =
      body && "error" in body && typeof body.error === "string"
        ? body.error
        : `Validity request failed (${response.status})`;
    throw new Error(message);
  }

  return body as ScenarioValidityState;
}

export function ScenarioValidityCard({
  scenarioId,
}: Readonly<{ scenarioId: RouteScenarioId }>) {
  const [state, setState] = useState<{
    error: string | null;
    isLoading: boolean;
    value: ScenarioValidityState | null;
  }>({
    error: null,
    isLoading: true,
    value: null,
  });

  useEffect(() => {
    let cancelled = false;

    setState({ error: null, isLoading: true, value: null });

    fetchValidityState(scenarioId)
      .then((value) => {
        if (!cancelled) {
          setState({ error: null, isLoading: false, value });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            error: error instanceof Error ? error.message : String(error),
            isLoading: false,
            value: null,
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [scenarioId]);

  if (state.isLoading) {
    return (
      <Card className="border-border/60 shadow-sm" size="sm">
        <CardHeader className="border-border/60 border-b">
          <CardTitle>Identity Validity</CardTitle>
          <CardDescription>Checking issuer validity state...</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (state.error) {
    return (
      <Card className="border-destructive/25 shadow-sm" size="sm">
        <CardHeader className="border-destructive/20 border-b">
          <CardTitle>Identity Validity</CardTitle>
          <CardDescription>
            The RP could not read the current issuer validity state.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p className="text-destructive">{state.error}</p>
        </CardContent>
      </Card>
    );
  }

  if (!state.value) {
    return null;
  }

  const currentStatus =
    state.value.snapshot?.validityStatus ??
    state.value.latestNotice?.validityStatus ??
    "pending";
  const hasRecoveredState =
    state.value.latestNotice?.eventId &&
    state.value.snapshot?.eventId &&
    state.value.latestNotice.eventId !== state.value.snapshot.eventId;

  return (
    <Card className="border-border/60 shadow-sm" size="sm">
      <CardHeader className="border-border/60 border-b">
        <CardTitle>Identity Validity</CardTitle>
        <CardDescription>
          RP-side view of the current issuer validity state for this session.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={getBadgeVariant(currentStatus)}>
            {formatStatusLabel(currentStatus)}
          </Badge>
          {hasRecoveredState && (
            <Badge variant="outline">Recovered via pull</Badge>
          )}
          {state.value.latestNotice && (
            <Badge variant="outline">Push received</Badge>
          )}
        </div>

        <div className="grid gap-2 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground">Current event:</span>
            <span className="font-mono text-xs">
              {state.value.snapshot?.eventId ?? "none"}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground">Subject:</span>
            <span className="font-mono text-xs">
              {state.value.subject ?? "unavailable"}
            </span>
          </div>
          {state.value.snapshot?.reason && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground">Reason:</span>
              <span>{state.value.snapshot.reason}</span>
            </div>
          )}
          {state.value.latestNotice && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground">Last notice:</span>
              <span className="font-mono text-xs">
                {state.value.latestNotice.eventId}
              </span>
            </div>
          )}
          {state.value.pullError && (
            <p className="text-amber-600 text-xs">
              Pull recovery is unavailable: {state.value.pullError}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
