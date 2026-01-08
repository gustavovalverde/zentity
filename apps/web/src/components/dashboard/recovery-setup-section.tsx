"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { FHE_SECRET_TYPE } from "@/lib/crypto/fhe-key-store";
import { PROFILE_SECRET_TYPE } from "@/lib/crypto/profile-secret";
import { addRecoveryWrapperForSecretType } from "@/lib/crypto/secret-vault";
import { trpc, trpcReact } from "@/lib/trpc/client";

const SECRET_LABELS: Record<string, string> = {
  [FHE_SECRET_TYPE]: "FHE key",
  [PROFILE_SECRET_TYPE]: "Profile key",
};

export function RecoverySetupSection() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isAddingGuardian, setIsAddingGuardian] = useState(false);
  const [guardianEmail, setGuardianEmail] = useState("");

  const configQuery = trpcReact.recovery.config.useQuery();
  const config = configQuery.data?.config ?? null;

  const guardiansQuery = trpcReact.recovery.listGuardians.useQuery(undefined, {
    enabled: Boolean(config),
  });
  const guardians = guardiansQuery.data?.guardians ?? [];

  const wrappersQuery = trpcReact.recovery.wrappersStatus.useQuery(undefined, {
    enabled: Boolean(config),
  });
  const wrappersStatus = wrappersQuery.data;

  const isEnabled = Boolean(config);

  const guardianSlots = useMemo(() => {
    if (!config) {
      return { filled: 0, total: 0 };
    }
    return { filled: guardians.length, total: config.totalGuardians };
  }, [config, guardians.length]);

  const handleEnable = async () => {
    setIsSubmitting(true);
    try {
      const result = await trpc.recovery.setup.mutate({});
      await configQuery.refetch();
      Promise.all([
        addRecoveryWrapperForSecretType({ secretType: FHE_SECRET_TYPE }),
        addRecoveryWrapperForSecretType({ secretType: PROFILE_SECRET_TYPE }),
      ]).catch(() => {
        toast.message(
          "Recovery enabled, but wrappers could not be prepared yet."
        );
      });
      toast.success(
        result.created ? "Recovery enabled" : "Recovery already enabled"
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to enable recovery.";
      toast.error("Recovery setup failed", { description: message });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAddGuardian = async () => {
    const trimmed = guardianEmail.trim();
    if (!trimmed) {
      toast.message("Enter an email address first.");
      return;
    }
    setIsAddingGuardian(true);
    try {
      const result = await trpc.recovery.addGuardianEmail.mutate({
        email: trimmed,
      });
      setGuardianEmail("");
      await guardiansQuery.refetch();
      toast.success(
        result.created ? "Guardian added" : "Guardian already added"
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to add guardian.";
      toast.error("Could not add guardian", { description: message });
    } finally {
      setIsAddingGuardian(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Social recovery</CardTitle>
        <CardDescription>
          Add guardians who can approve a recovery if you lose access to your
          passkey.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!isEnabled && (
          <>
            <p className="text-muted-foreground text-sm">
              Guardians will authorize recovery for this account.
            </p>
            <Button disabled={isSubmitting} onClick={handleEnable}>
              {isSubmitting ? (
                <>
                  <Spinner className="mr-2 size-4" />
                  Enabling recovery...
                </>
              ) : (
                "Enable recovery"
              )}
            </Button>
          </>
        )}

        {isEnabled && config ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-muted-foreground text-sm">
              <span>
                Threshold {config.threshold} of {config.totalGuardians}
              </span>
              <Badge variant="secondary">
                {guardianSlots.filled}/{guardianSlots.total} guardians
              </Badge>
            </div>
            <p className="text-muted-foreground text-sm">
              Group key: {config.frostGroupPubkey.slice(0, 12)}...
            </p>

            <div className="space-y-2">
              <div className="flex items-center justify-between font-medium text-sm">
                <span>Guardians</span>
                <Badge variant="outline">
                  {guardianSlots.filled}/{guardianSlots.total}
                </Badge>
              </div>
              {guardiansQuery.isLoading ? (
                <div className="flex items-center gap-2 text-muted-foreground text-sm">
                  <Spinner className="size-4" />
                  Loading guardians...
                </div>
              ) : null}
              {!guardiansQuery.isLoading && guardians.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  No guardians added yet.
                </p>
              ) : null}
              {guardians.map((guardian) => (
                <div
                  className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
                  key={guardian.id}
                >
                  <div>
                    <div className="font-medium">{guardian.email}</div>
                    <div className="text-muted-foreground text-xs">
                      Participant {guardian.participantIndex}
                    </div>
                  </div>
                  <Badge variant="secondary">{guardian.status}</Badge>
                </div>
              ))}
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  disabled={isAddingGuardian}
                  onChange={(event) => setGuardianEmail(event.target.value)}
                  placeholder="guardian@example.com"
                  value={guardianEmail}
                />
                <Button
                  disabled={isAddingGuardian}
                  onClick={handleAddGuardian}
                  type="button"
                  variant="secondary"
                >
                  {isAddingGuardian ? "Adding..." : "Add guardian"}
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between font-medium text-sm">
                <span>Recovery wrappers</span>
                <Badge variant="outline">
                  {wrappersStatus?.wrappedCount ?? 0}/
                  {wrappersStatus?.totalSecrets ?? 0}
                </Badge>
              </div>
              {wrappersQuery.isLoading ? (
                <div className="flex items-center gap-2 text-muted-foreground text-sm">
                  <Spinner className="size-4" />
                  Loading recovery wrappers...
                </div>
              ) : null}
              {!wrappersQuery.isLoading &&
              (!wrappersStatus || wrappersStatus.totalSecrets === 0) ? (
                <p className="text-muted-foreground text-sm">
                  No secrets stored yet.
                </p>
              ) : null}
              {wrappersStatus?.secrets.map((secret) => (
                <div
                  className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
                  key={secret.secretId}
                >
                  <span>
                    {SECRET_LABELS[secret.secretType] ?? secret.secretType}
                  </span>
                  <Badge variant={secret.hasWrapper ? "secondary" : "outline"}>
                    {secret.hasWrapper ? "Ready" : "Missing"}
                  </Badge>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
