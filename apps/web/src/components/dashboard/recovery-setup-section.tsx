"use client";

import { Trash2 } from "lucide-react";
import { memo, useCallback, useMemo, useState } from "react";
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

// Type for guardian from API
interface Guardian {
  id: string;
  email: string | null;
  guardianType: string;
  participantIndex: number;
  status: string;
}

// Type for wrapper secret from API
interface WrapperSecret {
  secretId: string;
  secretType: string;
  hasWrapper: boolean;
}

/**
 * Recovery ID display with copy and download actions.
 */
const RecoveryIdSection = memo(function RecoveryIdSection({
  recoveryId,
}: {
  recoveryId: string | null;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    if (!recoveryId) {
      return;
    }
    try {
      await navigator.clipboard.writeText(recoveryId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Could not copy Recovery ID.");
    }
  }, [recoveryId]);

  const handleDownload = useCallback(() => {
    if (!recoveryId) {
      return;
    }
    const content = `Zentity Recovery ID\n\n${recoveryId}\n\nKeep this ID safe. You can use it to start account recovery if you lose access to your passkey.`;
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "zentity-recovery-id.txt";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    toast.success("Recovery ID downloaded.");
  }, [recoveryId]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between font-medium text-sm">
        <span>Recovery ID</span>
        <Badge variant="outline">{recoveryId ? "Saved" : "Generating"}</Badge>
      </div>
      <p className="text-muted-foreground text-sm">
        Keep this ID safe. You can use it to start a recovery if you lose access
        to your passkey.
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input readOnly value={recoveryId ?? "Loading..."} />
        <Button
          disabled={!recoveryId}
          onClick={handleCopy}
          type="button"
          variant="secondary"
        >
          {copied ? "Copied" : "Copy ID"}
        </Button>
        <Button
          disabled={!recoveryId}
          onClick={handleDownload}
          type="button"
          variant="secondary"
        >
          Download ID
        </Button>
      </div>
    </div>
  );
});

/**
 * Guardian list with add and remove functionality.
 */
const GuardiansSection = memo(function GuardiansSection({
  guardians,
  isLoading,
  filledSlots,
  totalSlots,
  onRefetch,
}: {
  guardians: Guardian[];
  isLoading: boolean;
  filledSlots: number;
  totalSlots: number;
  onRefetch: () => Promise<void>;
}) {
  const [email, setEmail] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const handleAdd = useCallback(async () => {
    const trimmed = email.trim();
    if (!trimmed) {
      toast.message("Enter an email address first.");
      return;
    }
    setIsAdding(true);
    try {
      const result = await trpc.recovery.addGuardianEmail.mutate({
        email: trimmed,
      });
      setEmail("");
      await onRefetch();
      toast.success(
        result.created ? "Guardian added" : "Guardian already added"
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to add guardian.";
      toast.error("Could not add guardian", { description: message });
    } finally {
      setIsAdding(false);
    }
  }, [email, onRefetch]);

  const handleRemove = useCallback(
    async (guardianId: string) => {
      if (removingId) {
        return;
      }
      setRemovingId(guardianId);
      try {
        await trpc.recovery.removeGuardian.mutate({ guardianId });
        await onRefetch();
        toast.success("Guardian removed");
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to remove guardian.";
        toast.error("Could not remove guardian", { description: message });
      } finally {
        setRemovingId(null);
      }
    },
    [removingId, onRefetch]
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between font-medium text-sm">
        <span>Guardians</span>
        <Badge variant="outline">
          {filledSlots}/{totalSlots}
        </Badge>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Spinner className="size-4" />
          Loading guardians...
        </div>
      ) : null}

      {!isLoading && guardians.length === 0 ? (
        <p className="text-muted-foreground text-sm">No guardians added yet.</p>
      ) : null}

      {guardians.map((guardian) => (
        <div
          className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
          key={guardian.id}
        >
          <div>
            <div className="font-medium">
              {guardian.guardianType === RECOVERY_GUARDIAN_TYPE_TWO_FACTOR
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
              disabled={removingId === guardian.id}
              onClick={() => handleRemove(guardian.id)}
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
          disabled={isAdding}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="guardian@example.com"
          value={email}
        />
        <Button
          disabled={isAdding}
          onClick={handleAdd}
          type="button"
          variant="secondary"
        >
          {isAdding ? "Adding..." : "Add guardian"}
        </Button>
      </div>
    </div>
  );
});

/**
 * Two-factor authenticator guardian linking.
 */
const TwoFactorGuardianSection = memo(function TwoFactorGuardianSection({
  isTwoFactorConfigured,
  hasTwoFactorGuardian,
  onRefetch,
}: {
  isTwoFactorConfigured: boolean;
  hasTwoFactorGuardian: boolean;
  onRefetch: () => Promise<void>;
}) {
  const [isLinking, setIsLinking] = useState(false);

  const buttonLabel = useMemo(() => {
    if (hasTwoFactorGuardian) {
      return "Authenticator guardian linked";
    }
    if (isLinking) {
      return "Linking authenticator guardian...";
    }
    return "Link authenticator guardian";
  }, [hasTwoFactorGuardian, isLinking]);

  const handleLink = useCallback(async () => {
    if (isLinking) {
      return;
    }
    setIsLinking(true);
    try {
      const result = await trpc.recovery.addGuardianTwoFactor.mutate();
      await onRefetch();
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
      setIsLinking(false);
    }
  }, [isLinking, onRefetch]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between font-medium text-sm">
        <span>Authenticator guardian</span>
        {hasTwoFactorGuardian ? <Badge variant="outline">Linked</Badge> : null}
      </div>
      <p className="text-muted-foreground text-xs">
        {isTwoFactorConfigured
          ? "Use your authenticator app (2FA) as a recovery guardian."
          : "Enable two-factor authentication to link your authenticator as a guardian."}
      </p>
      <Button
        disabled={!isTwoFactorConfigured || hasTwoFactorGuardian || isLinking}
        onClick={handleLink}
        type="button"
        variant="secondary"
      >
        {buttonLabel}
      </Button>
    </div>
  );
});

/**
 * Recovery wrappers status display.
 */
const RecoveryWrappersSection = memo(function RecoveryWrappersSection({
  isLoading,
  wrappedCount,
  totalSecrets,
  secrets,
}: {
  isLoading: boolean;
  wrappedCount: number;
  totalSecrets: number;
  secrets: WrapperSecret[];
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between font-medium text-sm">
        <span>Recovery wrappers</span>
        <Badge variant="outline">
          {wrappedCount}/{totalSecrets}
        </Badge>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Spinner className="size-4" />
          Loading recovery wrappers...
        </div>
      ) : null}

      {!isLoading && totalSecrets === 0 ? (
        <p className="text-muted-foreground text-sm">No secrets stored yet.</p>
      ) : null}

      {secrets.map((secret) => (
        <div
          className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
          key={secret.secretId}
        >
          <span>{SECRET_LABELS[secret.secretType] ?? secret.secretType}</span>
          <Badge variant={secret.hasWrapper ? "secondary" : "outline"}>
            {secret.hasWrapper ? "Ready" : "Missing"}
          </Badge>
        </div>
      ))}
    </div>
  );
});

/**
 * Main recovery setup section.
 * Orchestrates data fetching and delegates rendering to sub-components.
 */
export function RecoverySetupSection() {
  const [isEnabling, setIsEnabling] = useState(false);

  const configQuery = trpcReact.recovery.config.useQuery();
  const config = configQuery.data?.config ?? null;
  const isEnabled = Boolean(config);

  const guardiansQuery = trpcReact.recovery.listGuardians.useQuery(undefined, {
    enabled: isEnabled,
  });
  const guardians = (guardiansQuery.data?.guardians ?? []) as Guardian[];

  const { data: sessionData } = useSession();
  const isTwoFactorConfigured = Boolean(sessionData?.user?.twoFactorEnabled);

  const recoveryIdQuery = trpcReact.recovery.identifier.useQuery();
  const recoveryId = recoveryIdQuery.data?.recoveryId ?? null;

  const wrappersQuery = trpcReact.recovery.wrappersStatus.useQuery(undefined, {
    enabled: isEnabled,
  });
  const wrappersStatus = wrappersQuery.data;

  const guardianSlots = useMemo(() => {
    if (!config) {
      return { filled: 0, total: 0 };
    }
    return { filled: guardians.length, total: config.totalGuardians };
  }, [config, guardians.length]);

  const hasTwoFactorGuardian = useMemo(
    () =>
      guardians.some(
        (g) => g.guardianType === RECOVERY_GUARDIAN_TYPE_TWO_FACTOR
      ),
    [guardians]
  );

  const handleEnable = useCallback(async () => {
    setIsEnabling(true);
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
      setIsEnabling(false);
    }
  }, [configQuery]);

  const refetchGuardians = useCallback(async () => {
    await guardiansQuery.refetch();
  }, [guardiansQuery]);

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
        <RecoveryIdSection recoveryId={recoveryId} />

        {!isEnabled && (
          <>
            <p className="text-muted-foreground text-sm">
              Guardians will authorize recovery for this account.
            </p>
            <Button disabled={isEnabling} onClick={handleEnable}>
              {isEnabling ? (
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

            <GuardiansSection
              filledSlots={guardianSlots.filled}
              guardians={guardians}
              isLoading={guardiansQuery.isLoading}
              onRefetch={refetchGuardians}
              totalSlots={guardianSlots.total}
            />

            <TwoFactorGuardianSection
              hasTwoFactorGuardian={hasTwoFactorGuardian}
              isTwoFactorConfigured={isTwoFactorConfigured}
              onRefetch={refetchGuardians}
            />

            <RecoveryWrappersSection
              isLoading={wrappersQuery.isLoading}
              secrets={(wrappersStatus?.secrets ?? []) as WrapperSecret[]}
              totalSecrets={wrappersStatus?.totalSecrets ?? 0}
              wrappedCount={wrappersStatus?.wrappedCount ?? 0}
            />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
