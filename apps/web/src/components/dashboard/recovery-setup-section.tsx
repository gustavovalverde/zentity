"use client";

import { Trash2 } from "lucide-react";
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
import { useSession } from "@/lib/auth/auth-client";
import { FHE_SECRET_TYPE } from "@/lib/crypto/fhe-key-store";
import { PROFILE_SECRET_TYPE } from "@/lib/crypto/profile-secret";
import { addRecoveryWrapperForSecretType } from "@/lib/crypto/secret-vault";
import { RECOVERY_GUARDIAN_TYPE_TWO_FACTOR } from "@/lib/recovery/constants";
import { trpc, trpcReact } from "@/lib/trpc/client";

const SECRET_LABELS: Record<string, string> = {
  [FHE_SECRET_TYPE]: "FHE key",
  [PROFILE_SECRET_TYPE]: "Profile key",
};

export function RecoverySetupSection() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isAddingGuardian, setIsAddingGuardian] = useState(false);
  const [isLinkingTwoFactor, setIsLinkingTwoFactor] = useState(false);
  const [removingGuardianId, setRemovingGuardianId] = useState<string | null>(
    null
  );
  const [guardianEmail, setGuardianEmail] = useState("");
  const [copiedRecoveryId, setCopiedRecoveryId] = useState(false);

  const configQuery = trpcReact.recovery.config.useQuery();
  const config = configQuery.data?.config ?? null;

  const guardiansQuery = trpcReact.recovery.listGuardians.useQuery(undefined, {
    enabled: Boolean(config),
  });
  const guardians = guardiansQuery.data?.guardians ?? [];

  const { data: sessionData } = useSession();

  const recoveryIdQuery = trpcReact.recovery.identifier.useQuery();
  const recoveryId = recoveryIdQuery.data?.recoveryId ?? null;

  const isTwoFactorConfigured = Boolean(sessionData?.user?.twoFactorEnabled);

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

  const hasTwoFactorGuardian = useMemo(
    () =>
      guardians.some(
        (guardian) =>
          guardian.guardianType === RECOVERY_GUARDIAN_TYPE_TWO_FACTOR
      ),
    [guardians]
  );

  const twoFactorGuardianLabel = useMemo(() => {
    if (hasTwoFactorGuardian) {
      return "Authenticator guardian linked";
    }
    if (isLinkingTwoFactor) {
      return "Linking authenticator guardian...";
    }
    return "Link authenticator guardian";
  }, [hasTwoFactorGuardian, isLinkingTwoFactor]);

  const downloadTextFile = (params: { filename: string; content: string }) => {
    const blob = new Blob([params.content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = params.filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const handleCopyRecoveryId = async () => {
    if (!recoveryId) {
      return;
    }
    try {
      await navigator.clipboard.writeText(recoveryId);
      setCopiedRecoveryId(true);
      setTimeout(() => setCopiedRecoveryId(false), 2000);
    } catch {
      toast.error("Could not copy Recovery ID.");
    }
  };

  const handleDownloadRecoveryId = () => {
    if (!recoveryId) {
      return;
    }
    const content = `Zentity Recovery ID\n\n${recoveryId}\n\nKeep this ID safe. You can use it to start account recovery if you lose access to your passkey.`;
    downloadTextFile({
      filename: "zentity-recovery-id.txt",
      content,
    });
    toast.success("Recovery ID downloaded.");
  };

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

  const handleLinkTwoFactorGuardian = async () => {
    if (isLinkingTwoFactor) {
      return;
    }
    setIsLinkingTwoFactor(true);
    try {
      const result = await trpc.recovery.addGuardianTwoFactor.mutate();
      await guardiansQuery.refetch();
      toast.success(
        result.created
          ? "Authenticator guardian linked"
          : "Authenticator guardian already linked"
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to link authenticator guardian.";
      toast.error("Could not link authenticator guardian", {
        description: message,
      });
    } finally {
      setIsLinkingTwoFactor(false);
    }
  };

  const handleRemoveGuardian = async (params: {
    guardianId: string;
    guardianType: string;
  }) => {
    if (removingGuardianId) {
      return;
    }
    setRemovingGuardianId(params.guardianId);
    try {
      await trpc.recovery.removeGuardian.mutate({
        guardianId: params.guardianId,
      });
      await guardiansQuery.refetch();
      toast.success("Guardian removed");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to remove guardian.";
      toast.error("Could not remove guardian", { description: message });
    } finally {
      setRemovingGuardianId(null);
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
        <div className="space-y-2">
          <div className="flex items-center justify-between font-medium text-sm">
            <span>Recovery ID</span>
            {recoveryId ? (
              <Badge variant="outline">Saved</Badge>
            ) : (
              <Badge variant="outline">Generating</Badge>
            )}
          </div>
          <p className="text-muted-foreground text-sm">
            Keep this ID safe. You can use it to start a recovery if you lose
            access to your passkey.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input readOnly value={recoveryId ?? "Loading..."} />
            <Button
              disabled={!recoveryId}
              onClick={handleCopyRecoveryId}
              type="button"
              variant="secondary"
            >
              {copiedRecoveryId ? "Copied" : "Copy ID"}
            </Button>
            <Button
              disabled={!recoveryId}
              onClick={handleDownloadRecoveryId}
              type="button"
              variant="secondary"
            >
              Download ID
            </Button>
          </div>
        </div>

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
                    <div className="font-medium">
                      {guardian.guardianType ===
                      RECOVERY_GUARDIAN_TYPE_TWO_FACTOR
                        ? "Authenticator app"
                        : guardian.email}
                    </div>
                    <div className="text-muted-foreground text-xs">
                      Participant {guardian.participantIndex}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">{guardian.status}</Badge>
                    <Button
                      aria-label="Remove guardian"
                      className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                      disabled={removingGuardianId === guardian.id}
                      onClick={() =>
                        handleRemoveGuardian({
                          guardianId: guardian.id,
                          guardianType: guardian.guardianType,
                        })
                      }
                      size="sm"
                      title="Remove guardian"
                      variant="ghost"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
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
              <div className="space-y-2">
                <div className="flex items-center justify-between font-medium text-sm">
                  <span>Authenticator guardian</span>
                  {hasTwoFactorGuardian ? (
                    <Badge variant="outline">Linked</Badge>
                  ) : null}
                </div>
                <p className="text-muted-foreground text-xs">
                  {isTwoFactorConfigured
                    ? "Use your authenticator app (2FA) as a recovery guardian."
                    : "Enable two-factor authentication to link your authenticator as a guardian."}
                </p>
                <Button
                  disabled={
                    !isTwoFactorConfigured ||
                    hasTwoFactorGuardian ||
                    isLinkingTwoFactor
                  }
                  onClick={handleLinkTwoFactorGuardian}
                  type="button"
                  variant="secondary"
                >
                  {twoFactorGuardianLabel}
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
