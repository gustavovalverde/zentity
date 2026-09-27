"use client";

import type { VaultAccess } from "@/lib/privacy/secrets/vault-access";

import { FileKey } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { RecoveryKeySetup } from "@/components/recovery-key-setup";
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
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { useVaultKeyPrompt } from "@/components/vault-unlock";
import { asyncHandler, reportRejection } from "@/lib/async-handler";
import { RECOVERY_KEY_CREDENTIAL_ID } from "@/lib/privacy/secrets/catalog";
import {
  removeVaultCredential,
  type VaultKey,
} from "@/lib/privacy/secrets/vault";

function formatDate(value: string): string {
  const date = new Date(
    value.includes("T") ? value : `${value.replace(" ", "T")}Z`
  );
  return Number.isNaN(date.getTime())
    ? "Unknown date"
    : date.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
}

export function RecoveryKeySection({
  access,
}: Readonly<{ access: VaultAccess | null }>) {
  const router = useRouter();
  const { dialog, requestVaultKey } = useVaultKeyPrompt();
  const [setupKey, setSetupKey] = useState<VaultKey | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const recoveryKey = access?.recoveryKey ?? null;

  const startSetup = async () => {
    setBusy(true);
    try {
      const request = await requestVaultKey();
      if (request.status === "unlocked") {
        setSetupKey(request.vaultKey);
      }
    } catch (err) {
      toast.error("Couldn't open your encrypted data", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await removeVaultCredential(RECOVERY_KEY_CREDENTIAL_ID);
      toast.success("Recovery key removed");
      router.refresh();
    } catch (err) {
      toast.error("Couldn't remove your recovery key", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setBusy(false);
      setConfirmRemove(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileKey className="h-5 w-5" />
          Recovery Key
        </CardTitle>
        <CardDescription>
          24 words that open your encryption keys and verified profile if you
          lose your other sign-in methods
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {access ? (
          <>
            <p className="text-sm">
              {recoveryKey
                ? `Created ${formatDate(recoveryKey.createdAt)}.`
                : "You haven't saved a recovery key."}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={busy}
                onClick={asyncHandler(startSetup)}
                variant="outline"
              >
                {busy ? <Spinner aria-hidden="true" size="sm" /> : null}
                {recoveryKey ? "Replace recovery key" : "Create recovery key"}
              </Button>
              {recoveryKey ? (
                <Button
                  className="text-destructive hover:text-destructive"
                  disabled={busy}
                  onClick={() => setConfirmRemove(true)}
                  variant="ghost"
                >
                  Remove
                </Button>
              ) : null}
            </div>
          </>
        ) : (
          <p className="text-muted-foreground text-sm">
            Available once you set up encryption keys during identity
            verification.
          </p>
        )}
      </CardContent>

      {dialog}

      <Dialog
        onOpenChange={(open) => {
          if (!open) {
            setSetupKey(null);
          }
        }}
        open={setupKey !== null}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Save your recovery key</DialogTitle>
            <DialogDescription>
              This is the only time these words are shown.
            </DialogDescription>
          </DialogHeader>
          {setupKey ? (
            <RecoveryKeySetup
              onCancel={() => setSetupKey(null)}
              onSaved={() => {
                setSetupKey(null);
                toast.success("Recovery key saved");
                router.refresh();
              }}
              replacing={Boolean(recoveryKey)}
              vaultKey={setupKey}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      <AlertDialog onOpenChange={setConfirmRemove} open={confirmRemove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove your recovery key?</AlertDialogTitle>
            <AlertDialogDescription>
              The saved words will stop working. You'll only be able to open
              your encrypted data with your passkeys, password, or wallet.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={busy}
              onClick={(event) => {
                event.preventDefault();
                remove().catch(reportRejection);
              }}
            >
              Remove recovery key
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
