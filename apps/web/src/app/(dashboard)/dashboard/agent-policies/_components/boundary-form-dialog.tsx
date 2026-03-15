"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpcReact } from "@/lib/trpc/client";

interface BoundaryRow {
  boundaryType: string;
  clientId: string;
  config: Record<string, unknown>;
  enabled: boolean;
  id: string;
}

const BOUNDARY_TYPES = [
  { label: "Purchase", value: "purchase" },
  { label: "Scope", value: "scope" },
  { label: "Custom", value: "custom" },
] as const;

interface BoundaryFormDialogProps {
  boundary: BoundaryRow | null;
  onClose: () => void;
  open: boolean;
}

export function BoundaryFormDialog({
  boundary,
  onClose,
  open,
}: Readonly<BoundaryFormDialogProps>) {
  const isEdit = boundary !== null;
  const utils = trpcReact.useUtils();

  const [clientId, setClientId] = useState(boundary?.clientId ?? "");
  const [boundaryType, setBoundaryType] = useState<
    "purchase" | "scope" | "custom"
  >((boundary?.boundaryType as "purchase" | "scope" | "custom") ?? "purchase");

  // Purchase fields
  const [maxAmount, setMaxAmount] = useState(
    String(boundary?.config.maxAmount ?? "50")
  );
  const [currency, setCurrency] = useState(
    String(boundary?.config.currency ?? "USD")
  );
  const [dailyCap, setDailyCap] = useState(
    String(boundary?.config.dailyCap ?? "200")
  );
  const [cooldownMinutes, setCooldownMinutes] = useState(
    String(boundary?.config.cooldownMinutes ?? "0")
  );

  // Scope fields
  const [allowedScopes, setAllowedScopes] = useState(
    Array.isArray(boundary?.config.allowedScopes)
      ? (boundary.config.allowedScopes as string[]).join(", ")
      : ""
  );

  // Custom fields
  const [actionType, setActionType] = useState(
    String(boundary?.config.actionType ?? "")
  );
  const [dailyCount, setDailyCount] = useState(
    String(boundary?.config.dailyCount ?? "10")
  );

  const createMutation = trpcReact.agentBoundaries.create.useMutation({
    onSuccess: () => {
      utils.agentBoundaries.list.invalidate();
      toast.success("Policy created");
      onClose();
    },
    onError: (error) => toast.error(error.message),
  });

  const updateMutation = trpcReact.agentBoundaries.update.useMutation({
    onSuccess: () => {
      utils.agentBoundaries.list.invalidate();
      toast.success("Policy updated");
      onClose();
    },
    onError: (error) => toast.error(error.message),
  });

  const isSaving = createMutation.isPending || updateMutation.isPending;
  const submitLabel = isEdit ? "Update" : "Create";

  function buildConfig(): Record<string, unknown> {
    switch (boundaryType) {
      case "purchase":
        return {
          maxAmount: Number.parseFloat(maxAmount),
          currency,
          dailyCap: Number.parseFloat(dailyCap),
          cooldownMinutes: Number.parseInt(cooldownMinutes, 10),
        };
      case "scope":
        return {
          allowedScopes: allowedScopes
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        };
      case "custom":
        return {
          actionType,
          dailyCount: Number.parseInt(dailyCount, 10),
        };
      default:
        return {};
    }
  }

  function handleSubmit() {
    const config = buildConfig();
    if (isEdit) {
      updateMutation.mutate({ id: boundary.id, config });
    } else {
      createMutation.mutate({ clientId, boundaryType, config });
    }
  }

  return (
    <Dialog onOpenChange={(o) => !o && onClose()} open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Policy" : "Create Policy"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Update the auto-approval policy configuration."
              : "Create a new auto-approval policy for an agent."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {!isEdit && (
            <div className="space-y-2">
              <Label htmlFor="clientId">Client ID</Label>
              <Input
                id="clientId"
                onChange={(e) => setClientId(e.target.value)}
                placeholder="e.g. aether-demo"
                value={clientId}
              />
            </div>
          )}

          {!isEdit && (
            <div className="space-y-2">
              <Label>Boundary Type</Label>
              <div className="flex gap-2">
                {BOUNDARY_TYPES.map((t) => (
                  <Button
                    key={t.value}
                    onClick={() => setBoundaryType(t.value)}
                    size="sm"
                    variant={boundaryType === t.value ? "default" : "outline"}
                  >
                    {t.label}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {boundaryType === "purchase" && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="maxAmount">Max per transaction</Label>
                  <Input
                    id="maxAmount"
                    onChange={(e) => setMaxAmount(e.target.value)}
                    type="number"
                    value={maxAmount}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="currency">Currency</Label>
                  <Input
                    id="currency"
                    onChange={(e) => setCurrency(e.target.value)}
                    value={currency}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="dailyCap">Daily cap</Label>
                  <Input
                    id="dailyCap"
                    onChange={(e) => setDailyCap(e.target.value)}
                    type="number"
                    value={dailyCap}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="cooldown">Cooldown (minutes)</Label>
                  <Input
                    id="cooldown"
                    onChange={(e) => setCooldownMinutes(e.target.value)}
                    type="number"
                    value={cooldownMinutes}
                  />
                </div>
              </div>
            </>
          )}

          {boundaryType === "scope" && (
            <div className="space-y-2">
              <Label htmlFor="allowedScopes">Allowed scopes</Label>
              <Input
                id="allowedScopes"
                onChange={(e) => setAllowedScopes(e.target.value)}
                placeholder="proof:age, proof:nationality"
                value={allowedScopes}
              />
              <p className="text-muted-foreground text-xs">
                Comma-separated. Identity scopes (identity.*) are never allowed.
              </p>
            </div>
          )}

          {boundaryType === "custom" && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="actionType">Action type</Label>
                <Input
                  id="actionType"
                  onChange={(e) => setActionType(e.target.value)}
                  placeholder="e.g. purchase"
                  value={actionType}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="dailyCount">Max per day</Label>
                <Input
                  id="dailyCount"
                  onChange={(e) => setDailyCount(e.target.value)}
                  type="number"
                  value={dailyCount}
                />
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button disabled={isSaving} onClick={onClose} variant="outline">
            Cancel
          </Button>
          <Button disabled={isSaving} onClick={handleSubmit}>
            {isSaving ? "Saving..." : submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
