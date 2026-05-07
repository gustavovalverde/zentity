"use client";

import type { IDKitResult, RpContext } from "@worldcoin/idkit";

import { BadgeCheck, Link2, Loader2, Unlink } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { reportRejection } from "@/lib/async-handler";

interface WorldIdRequest {
  action: string;
  appId: `app_${string}`;
  challengeId: string;
  environment: "production" | "staging";
  rpContext: RpContext;
}

interface WorldIdHumanSignalProps {
  linked: boolean;
  userId: string;
}

type WorldIdRuntime = Pick<
  typeof import("@worldcoin/idkit"),
  "IDKitRequestWidget" | "orbLegacy"
>;

interface WorldIdWidgetState {
  request: WorldIdRequest;
  runtime: WorldIdRuntime;
}

export function WorldIdHumanSignal({
  linked,
  userId,
}: Readonly<WorldIdHumanSignalProps>) {
  const router = useRouter();
  const [widget, setWidget] = useState<WorldIdWidgetState | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function startLink() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/world-id/rp-context", {
        method: "POST",
      });
      if (!response.ok) {
        throw new Error("World ID is unavailable");
      }
      const request = (await response.json()) as WorldIdRequest;
      const runtime = await import("@worldcoin/idkit");
      setWidget({
        runtime: {
          IDKitRequestWidget: runtime.IDKitRequestWidget,
          orbLegacy: runtime.orbLegacy,
        },
        request,
      });
    } catch (startError) {
      setError(
        startError instanceof Error ? startError.message : "World ID failed"
      );
    } finally {
      setPending(false);
    }
  }

  async function detach() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/world-id/detach", {
        method: "POST",
      });
      if (!response.ok) {
        throw new Error("Could not remove World ID");
      }
      router.refresh();
    } catch (detachError) {
      setError(
        detachError instanceof Error ? detachError.message : "World ID failed"
      );
    } finally {
      setPending(false);
    }
  }

  async function attach(result: IDKitResult) {
    if (!widget) {
      throw new Error("Missing World ID request");
    }
    const response = await fetch("/api/world-id/attach", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        challengeId: widget.request.challengeId,
        idkitResult: result,
      }),
    });
    if (!response.ok) {
      throw new Error("World ID verification failed");
    }
  }

  function handleStartLink() {
    startLink().catch(reportRejection);
  }

  function handleDetach() {
    detach().catch(reportRejection);
  }

  function handleOpenChange(next: boolean) {
    if (!next) {
      setWidget(null);
    }
  }

  function handleSuccess() {
    setWidget(null);
    router.refresh();
  }

  return (
    <div className="flex flex-col items-center gap-2">
      {linked ? (
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Badge className="gap-1" variant="secondary">
            <BadgeCheck className="h-3.5 w-3.5" />
            World ID Linked
          </Badge>
          <Button
            disabled={pending}
            onClick={handleDetach}
            size="sm"
            type="button"
            variant="outline"
          >
            {pending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Unlink className="mr-2 h-4 w-4" />
            )}
            Remove
          </Button>
        </div>
      ) : (
        <Button
          disabled={pending}
          onClick={handleStartLink}
          type="button"
          variant="outline"
        >
          {pending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Link2 className="mr-2 h-4 w-4" />
          )}
          Link World ID
        </Button>
      )}

      {error && <p className="text-destructive text-xs">{error}</p>}

      {widget && (
        <widget.runtime.IDKitRequestWidget
          action={widget.request.action}
          allow_legacy_proofs
          app_id={widget.request.appId}
          environment={widget.request.environment}
          handleVerify={attach}
          onError={() => setError("World ID verification failed")}
          onOpenChange={handleOpenChange}
          onSuccess={handleSuccess}
          open
          preset={widget.runtime.orbLegacy({ signal: userId })}
          rp_context={widget.request.rpContext}
        />
      )}
    </div>
  );
}
