"use client";

import { PlusSignCircleIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

interface DcrRegistrationProps {
  clientName: string;
  defaultScopes: string;
  grantTypes?: string[] | undefined;
  onRegistered: (clientId: string) => void;
  providerId: string;
}

type RegistrationState =
  | { status: "checking" }
  | { status: "idle" }
  | { status: "registering" }
  | { status: "done" };

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

export function DcrRegistration({
  providerId,
  clientName,
  defaultScopes,
  grantTypes,
  onRegistered,
}: DcrRegistrationProps) {
  const [state, setState] = useState<RegistrationState>({
    status: "checking",
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/dcr?providerId=${encodeURIComponent(providerId)}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) {
          return;
        }
        if (data.registered && data.client_id) {
          setState({ status: "done" });
          onRegistered(data.client_id);
        } else {
          setState({ status: "idle" });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setState({ status: "idle" });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [providerId, onRegistered]);

  const handleRegister = async () => {
    setState({ status: "registering" });
    setError(null);
    try {
      const res = await fetch("/api/dcr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providerId,
          clientName,
          scopes: defaultScopes,
          ...(grantTypes ? { grantTypes } : {}),
        }),
      });
      const data = (await parseJsonResponse(res)) as {
        client_id?: string;
        error?: string;
      } | null;
      if (!res.ok) {
        setError(data?.error || `Registration failed (${res.status})`);
        setState({ status: "idle" });
        return;
      }
      if (!data?.client_id) {
        setError("Registration failed: missing client_id in response");
        setState({ status: "idle" });
        return;
      }
      setState({ status: "done" });
      onRegistered(data.client_id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Registration failed");
      setState({ status: "idle" });
    }
  };

  if (state.status === "checking") {
    return (
      <div className="animate-pulse text-muted-foreground text-sm">
        Checking registration...
      </div>
    );
  }

  if (state.status === "done") {
    return null;
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
          <span className="font-medium text-foreground">{clientName}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs">Scopes:</span>
          <span className="font-mono text-xs">{defaultScopes}</span>
        </div>
      </div>
      {error && <p className="text-destructive text-sm">{error}</p>}
      <Button
        className="w-full"
        disabled={state.status === "registering"}
        onClick={handleRegister}
        size="sm"
        variant="outline"
      >
        {state.status === "registering"
          ? "Registering..."
          : "Register with Zentity"}
      </Button>
      <p className="text-muted-foreground text-xs">
        Uses RFC 7591 Dynamic Client Registration
      </p>
    </div>
  );
}
