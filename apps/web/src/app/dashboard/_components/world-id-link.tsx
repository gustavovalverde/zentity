"use client";

import type { IDKitResult, RpContext } from "@worldcoin/idkit";

import { BadgeCheck, Link2, Loader2, Unlink } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { reportRejection } from "@/lib/async-handler";

/**
 * Provider id used by the dashboard "Link World ID" button. We currently
 * surface the orb-level credential; document and device variants register
 * via the same `/api/humanity/{provider}/...` route family if a separate
 * UI surface is added.
 */
const DEFAULT_WORLD_ID_PROVIDER_ID = "world_id_orb" as const;

interface WorldIdChallengePayload {
  action: string;
  appId: `app_${string}`;
  environment: "production" | "staging";
  rpContext: RpContext;
}

interface HumanityChallengeResponse {
  challengeId: string;
  expiresAt: string;
  nonce: string;
  payload: WorldIdChallengePayload;
  provider: string;
}

interface WorldIdLinkProps {
  linked: boolean;
  userId: string;
}

type WorldIdRuntime = Pick<
  typeof import("@worldcoin/idkit"),
  "IDKitRequestWidget" | "orbLegacy"
>;

interface WorldIdWidgetState {
  challenge: HumanityChallengeResponse;
  runtime: WorldIdRuntime;
}

export function WorldIdLink({ linked, userId }: Readonly<WorldIdLinkProps>) {
  const router = useRouter();
  const [widget, setWidget] = useState<WorldIdWidgetState | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function startLink() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/humanity/${DEFAULT_WORLD_ID_PROVIDER_ID}/challenge`,
        { method: "POST" }
      );
      if (!response.ok) {
        throw new Error("World ID is unavailable");
      }
      const challenge = (await response.json()) as HumanityChallengeResponse;
      const runtime = await import("@worldcoin/idkit");
      setWidget({
        challenge,
        runtime: {
          IDKitRequestWidget: runtime.IDKitRequestWidget,
          orbLegacy: runtime.orbLegacy,
        },
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
      const response = await fetch(
        `/api/humanity/${DEFAULT_WORLD_ID_PROVIDER_ID}/detach`,
        { method: "POST" }
      );
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
      throw new Error("Missing humanity challenge");
    }
    const response = await fetch(
      `/api/humanity/${widget.challenge.provider}/attach`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          challengeId: widget.challenge.challengeId,
          nonce: widget.challenge.nonce,
          proof: result,
        }),
      }
    );
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
          action={widget.challenge.payload.action}
          allow_legacy_proofs
          app_id={widget.challenge.payload.appId}
          environment={widget.challenge.payload.environment}
          handleVerify={attach}
          onError={() => setError("World ID verification failed")}
          onOpenChange={handleOpenChange}
          onSuccess={handleSuccess}
          open
          preset={widget.runtime.orbLegacy({ signal: userId })}
          rp_context={widget.challenge.payload.rpContext}
        />
      )}
    </div>
  );
}
