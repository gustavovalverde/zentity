"use client";

import {
  CheckmarkCircle02Icon,
  PlusSignCircleIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { RouteScenario } from "@/scenarios/route-scenario";

interface DcrRegistrationProps {
  autoRegister?: boolean;
  onRegistered: (clientId: string) => void;
  scenario: RouteScenario;
}

type RegistrationState =
  | { status: "checking" }
  | { status: "idle" }
  | { status: "registering" }
  | { status: "done"; clientId: string }
  | { status: "error"; reason: string };

async function parseJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

type DcrCallResult =
  | { ok: true; clientId: string }
  | { ok: false; error: string };

async function probeScenario(scenarioId: string): Promise<string | null> {
  try {
    const res = await fetch(
      `/api/dcr?scenarioId=${encodeURIComponent(scenarioId)}`
    );
    const data = (await res.json()) as {
      registered?: boolean;
      client_id?: string;
    };
    return data.registered && data.client_id ? data.client_id : null;
  } catch {
    return null;
  }
}

async function registerScenario(scenarioId: string): Promise<DcrCallResult> {
  try {
    const res = await fetch("/api/dcr", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scenarioId }),
    });
    const data = (await parseJsonResponse(res)) as {
      client_id?: string;
      error?: string;
    } | null;
    if (!res.ok) {
      return { ok: false, error: data?.error || `HTTP ${res.status}` };
    }
    if (!data?.client_id) {
      return { ok: false, error: "missing client_id in response" };
    }
    return { ok: true, clientId: data.client_id };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "network error",
    };
  }
}

export function DcrRegistration({
  autoRegister = true,
  onRegistered,
  scenario,
}: DcrRegistrationProps) {
  const [state, setState] = useState<RegistrationState>({
    status: "checking",
  });
  // Prevent the auto-register effect from firing twice (React 18 strict mode
  // double-invokes effects in dev). One in-flight registration per scenario is
  // enough; the GET probe is idempotent but POST creates a real client at Zentity.
  const autoRegisterAttempted = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const existing = await probeScenario(scenario.id);
      if (cancelled) {
        return;
      }
      if (existing) {
        setState({ status: "done", clientId: existing });
        onRegistered(existing);
        return;
      }

      if (!autoRegister) {
        setState({ status: "idle" });
        return;
      }

      if (autoRegisterAttempted.current) {
        return;
      }
      autoRegisterAttempted.current = true;

      setState({ status: "registering" });
      const result = await registerScenario(scenario.id);
      if (cancelled) {
        return;
      }
      if (result.ok) {
        setState({ status: "done", clientId: result.clientId });
        onRegistered(result.clientId);
      } else {
        setState({ status: "error", reason: result.error });
      }
    };

    run().catch(() => {
      if (!cancelled) {
        setState({ status: "error", reason: "unexpected failure" });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [scenario.id, onRegistered, autoRegister]);

  const handleRetry = async () => {
    setState({ status: "registering" });
    const result = await registerScenario(scenario.id);
    if (!result.ok) {
      setState({
        status: "error",
        reason: result.error ?? "unknown error",
      });
      return;
    }
    const clientId = result.clientId as string;
    setState({ status: "done", clientId });
    onRegistered(clientId);
  };

  if (state.status === "checking") {
    return (
      <div className="animate-pulse text-muted-foreground text-sm">
        Checking registration...
      </div>
    );
  }

  if (state.status === "registering") {
    return (
      <div className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
        <span className="size-2 animate-pulse rounded-full bg-primary" />
        <span className="text-muted-foreground">
          Registering {scenario.dcr.clientName} with Zentity...
        </span>
      </div>
    );
  }

  if (state.status === "done") {
    return (
      <div className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
        <HugeiconsIcon
          className="text-green-500"
          icon={CheckmarkCircle02Icon}
          size={14}
        />
        <span className="text-muted-foreground">Registered as</span>
        <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
          {state.clientId}
        </span>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="space-y-2 rounded-lg border border-destructive/40 p-3 text-sm">
        <p className="text-destructive">Registration failed: {state.reason}</p>
        <Button
          className="w-full"
          onClick={handleRetry}
          size="sm"
          variant="outline"
        >
          Retry registration
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="flex items-center gap-2">
        <HugeiconsIcon
          className="text-primary"
          icon={PlusSignCircleIcon}
          size={16}
        />
        <span className="font-medium text-sm">Dynamic Client Registration</span>
      </div>
      <div className="space-y-1.5 text-muted-foreground text-sm">
        <div className="flex items-center gap-2">
          <span className="text-xs">Client name:</span>
          <span className="font-medium text-foreground">
            {scenario.dcr.clientName}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs">Scopes:</span>
          <span className="font-mono text-xs">
            {scenario.dcr.requestedScopes}
          </span>
        </div>
      </div>
      <Button
        className="w-full"
        onClick={handleRetry}
        size="sm"
        variant="outline"
      >
        Register with Zentity
      </Button>
      <p className="text-muted-foreground text-xs">
        Uses RFC 7591 Dynamic Client Registration
      </p>
    </div>
  );
}
