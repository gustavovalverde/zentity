"use client";

import type { PolicyPrefill } from "./boundary-form-dialog";

import { Pencil, Plus, ShieldPlus, Trash2 } from "lucide-react";
import { useCallback, useState } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
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
import { Spinner } from "@/components/ui/spinner";
import { trpcReact } from "@/lib/trpc/client";

import { BoundaryFormDialog } from "./boundary-form-dialog";

interface BoundaryRow {
  boundaryType: string;
  clientId: string;
  clientName: string | null;
  config: Record<string, unknown>;
  createdAt: string;
  enabled: boolean;
  id: string;
  updatedAt: string;
}

function formatConfig(type: string, config: Record<string, unknown>): string {
  switch (type) {
    case "purchase": {
      const max = config.maxAmount as number;
      const currency = config.currency as string;
      const cap = config.dailyCap as number;
      const cooldown = config.cooldownMinutes as number;
      return `Up to ${max} ${currency}/tx, ${cap} ${currency}/day${cooldown > 0 ? `, ${cooldown}min cooldown` : ""}`;
    }
    case "scope": {
      const scopes = config.allowedScopes as string[];
      return scopes.join(", ");
    }
    case "custom": {
      const action = config.actionType as string;
      const count = config.dailyCount as number;
      return `${action}: ${count}/day`;
    }
    default:
      return JSON.stringify(config);
  }
}

function typeBadgeLabel(type: string): string {
  switch (type) {
    case "purchase":
      return "Purchase";
    case "scope":
      return "Scope";
    case "custom":
      return "Custom";
    default:
      return type;
  }
}

export function AgentPoliciesClient({
  prefill,
}: Readonly<{ prefill?: PolicyPrefill }>) {
  const utils = trpcReact.useUtils();
  const { data: boundaries, isLoading } =
    trpcReact.agentBoundaries.list.useQuery();

  const deleteMutation = trpcReact.agentBoundaries.delete.useMutation({
    onSuccess: () => {
      utils.agentBoundaries.list.invalidate();
      toast.success("Boundary deleted");
    },
    onError: (error) => toast.error(error.message),
  });

  const updateMutation = trpcReact.agentBoundaries.update.useMutation({
    onSuccess: () => {
      utils.agentBoundaries.list.invalidate();
    },
    onError: (error) => toast.error(error.message),
  });

  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [editTarget, setEditTarget] = useState<BoundaryRow | null>(null);
  const [showCreate, setShowCreate] = useState(prefill?.create ?? false);

  const handleToggle = useCallback(
    (id: string, enabled: boolean) => {
      updateMutation.mutate({ id, enabled: !enabled });
    },
    [updateMutation]
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner className="size-8" />
      </div>
    );
  }

  const grouped = new Map<string, BoundaryRow[]>();
  for (const boundary of boundaries ?? []) {
    const key = boundary.clientId;
    const group = grouped.get(key) ?? [];
    group.push(boundary);
    grouped.set(key, group);
  }

  return (
    <>
      <div className="flex justify-end">
        <Button onClick={() => setShowCreate(true)} size="sm">
          <Plus className="mr-2 size-4" />
          Add Policy
        </Button>
      </div>

      {grouped.size === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            <ShieldPlus className="mx-auto mb-3 size-8 opacity-50" />
            <p>No agent policies configured yet.</p>
            <p className="mt-1 text-sm">
              Create a policy to auto-approve specific agent requests.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {[...grouped.entries()].map(([clientId, items]) => (
            <Card key={clientId}>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">
                  {items[0]?.clientName ?? clientId}
                </CardTitle>
                <CardDescription>
                  {items.length} {items.length === 1 ? "policy" : "policies"}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {items.map((boundary) => (
                  <div
                    className="flex items-center justify-between rounded-lg border p-3"
                    key={boundary.id}
                  >
                    <div className="flex items-center gap-3">
                      <Badge variant="secondary">
                        {typeBadgeLabel(boundary.boundaryType)}
                      </Badge>
                      <span className="text-sm">
                        {formatConfig(boundary.boundaryType, boundary.config)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge
                        className="cursor-pointer"
                        onClick={() =>
                          handleToggle(boundary.id, boundary.enabled)
                        }
                        variant={boundary.enabled ? "default" : "outline"}
                      >
                        {boundary.enabled ? "Enabled" : "Disabled"}
                      </Badge>
                      <Button
                        onClick={() => setEditTarget(boundary)}
                        size="icon"
                        variant="ghost"
                      >
                        <Pencil className="size-4" />
                      </Button>
                      <Button
                        onClick={() => setDeleteTarget(boundary.id)}
                        size="icon"
                        variant="ghost"
                      >
                        <Trash2 className="size-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <BoundaryFormDialog
        boundary={editTarget}
        key={editTarget?.id ?? "create"}
        onClose={() => {
          setShowCreate(false);
          setEditTarget(null);
        }}
        open={showCreate || editTarget !== null}
        prefill={editTarget ? undefined : prefill}
      />

      <AlertDialog
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null);
          }
        }}
        open={deleteTarget !== null}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete policy?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the auto-approval policy. Future requests from
              this agent will require manual approval.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleteTarget) {
                  deleteMutation.mutate({ id: deleteTarget });
                  setDeleteTarget(null);
                }
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
