"use client";

import type { SecretType } from "@/lib/privacy/secrets/catalog";
import type { VaultAccess } from "@/lib/privacy/secrets/vault-access";

import {
  Check,
  Fingerprint,
  KeyRound,
  LockKeyhole,
  TriangleAlert,
} from "lucide-react";
import { useCallback, useEffect, useId, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import {
  hasVaultUnlockMethod,
  type VaultUnlockMethods,
  VaultUnlockOptions,
  vaultUnlockMethods,
} from "@/components/vault-unlock";
import { asyncHandler, reportRejection } from "@/lib/async-handler";
import { authClient } from "@/lib/auth/auth-client";
import { deletePasskey } from "@/lib/auth/passkey/client";
import { evaluatePrf } from "@/lib/auth/passkey/prf";
import { redirectTo } from "@/lib/auth/redirect";
import { generatePrfSalt } from "@/lib/privacy/credentials/derivation";
import { SECRET_TYPES } from "@/lib/privacy/secrets/catalog";
import {
  addVaultCredential,
  removeVaultCredential,
  type VaultCredentialMaterial,
  type VaultKey,
  verifyVaultCredential,
} from "@/lib/privacy/secrets/vault";
import { registerCredentialBinding } from "@/lib/privacy/zk/binding-context";
import { trpc } from "@/lib/trpc/client";

type PasskeyMaterial = Extract<VaultCredentialMaterial, { type: "passkey" }>;
type AccessPasskey = VaultAccess["passkeys"][number];

type Phase =
  | { name: "loading" }
  | { name: "no_vault" }
  | { name: "unlock" }
  | { name: "connect"; vaultKey: VaultKey }
  | { name: "remove_lost"; candidates: AccessPasskey[] }
  | { name: "fresh_start" }
  | { name: "done"; opened: SecretType[]; credentialLabel: string };

const SECRET_LABELS: Record<SecretType, string> = {
  [SECRET_TYPES.FHE_KEYS]: "Encryption keys",
  [SECRET_TYPES.PROFILE]: "Verified profile",
};

function unlockMethodsFor(
  access: VaultAccess,
  lostPasskey: boolean
): VaultUnlockMethods {
  const methods = vaultUnlockMethods(access);
  // With one connected passkey on the lost-passkey path, that passkey is the lost one.
  if (lostPasskey && methods.passkeyCredentialIds.length < 2) {
    return { ...methods, passkeyCredentialIds: [] };
  }
  return methods;
}

async function bindCredential(
  vaultKey: VaultKey,
  material: VaultCredentialMaterial
) {
  if (material.type === "passkey") {
    await registerCredentialBinding({
      secretId: vaultKey.secretId,
      credential: {
        type: "passkey",
        context: { userId: vaultKey.userId, ...material },
      },
    });
  } else if (material.type === "opaque") {
    await registerCredentialBinding({
      secretId: vaultKey.secretId,
      credential: {
        type: "opaque",
        context: { userId: vaultKey.userId, exportKey: material.exportKey },
      },
    });
  }
}

/**
 * Connects a replacement sign-in credential to the user's vault: open the
 * vault with any credential that still works (or the recovery key), wrap the
 * vault key for the replacement, and retire the credential that was lost.
 * When nothing can open the vault, offers to start over with new keys.
 */
export function VaultRecovery({
  newPasskey,
}: Readonly<{ newPasskey?: PasskeyMaterial | undefined }>) {
  const lostPasskey = newPasskey !== undefined;
  const [access, setAccess] = useState<VaultAccess | null>(null);
  const [phase, setPhase] = useState<Phase>({ name: "loading" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const finish = useCallback(
    async (material: VaultCredentialMaterial, credentialLabel: string) => {
      const opened = await verifyVaultCredential(material);
      setPhase({ name: "done", opened, credentialLabel });
    },
    []
  );

  useEffect(() => {
    let active = true;
    trpc.secrets.access
      .query()
      .then((result) => {
        if (!active) {
          return;
        }
        setAccess(result);
        const needsConnecting =
          lostPasskey ||
          (result !== null &&
            ((result.password !== null && !result.password.connected) ||
              result.passkeys.some((passkey) => !passkey.connected)));
        if (!(result && needsConnecting)) {
          if (lostPasskey) {
            setPhase({ name: "no_vault" });
          } else {
            redirectTo("/dashboard");
          }
          return;
        }
        setPhase(
          hasVaultUnlockMethod(unlockMethodsFor(result, lostPasskey))
            ? { name: "unlock" }
            : { name: "fresh_start" }
        );
      })
      .catch((err: unknown) => {
        if (active) {
          setError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      active = false;
    };
  }, [lostPasskey]);

  const lostCandidates = (unlockedWith: string | null): AccessPasskey[] =>
    (access?.passkeys ?? []).filter(
      (passkey) =>
        passkey.credentialId !== unlockedWith &&
        passkey.credentialId !== newPasskey?.credentialId
    );

  const retirePasskey = async (passkey: AccessPasskey) => {
    if (passkey.connected) {
      await removeVaultCredential(passkey.credentialId);
    }
    const result = await deletePasskey(passkey.id);
    if (result.error) {
      throw new Error(result.error.message || "Couldn't remove that passkey.");
    }
  };

  const handleUnlocked = async (vaultKey: VaultKey) => {
    setError(null);
    if (!newPasskey) {
      setPhase({ name: "connect", vaultKey });
      return;
    }

    await addVaultCredential(vaultKey, newPasskey);
    await bindCredential(vaultKey, newPasskey).catch(reportRejection);

    const candidates = lostCandidates(vaultKey.unlockedWith);
    const [onlyCandidate] = candidates;
    if (candidates.length === 1 && onlyCandidate) {
      await retirePasskey(onlyCandidate);
    } else if (candidates.length > 1) {
      setPhase({ name: "remove_lost", candidates });
      return;
    }
    await finish(newPasskey, "your new passkey");
  };

  const startOver = async () => {
    setBusy(true);
    setError(null);
    try {
      await trpc.secrets.resetVault.mutate();
      const [onlyCandidate, ...others] = lostCandidates(null);
      if (lostPasskey && onlyCandidate && others.length === 0) {
        await deletePasskey(onlyCandidate.id);
      }
      redirectTo("/dashboard/verify");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  const errorAlert = error ? (
    <Alert variant="destructive">
      <TriangleAlert />
      <AlertDescription>{error}</AlertDescription>
    </Alert>
  ) : null;

  switch (phase.name) {
    case "loading":
      return error ? (
        errorAlert
      ) : (
        <div className="flex justify-center py-6">
          <Spinner className="size-6 text-muted-foreground" />
        </div>
      );

    case "no_vault":
      return (
        <div className="space-y-4">
          <p className="text-muted-foreground text-sm">
            You can sign in with your new passkey. You haven&apos;t set up
            encryption keys yet, so there&apos;s no encrypted data to move.
          </p>
          <Button className="w-full" onClick={() => redirectTo("/dashboard")}>
            Go to dashboard
          </Button>
        </div>
      );

    case "unlock":
      return (
        <div className="space-y-4">
          <div className="space-y-1">
            <p className="font-medium">Open your encrypted data</p>
            <p className="text-muted-foreground text-sm">
              {lostPasskey
                ? "Your encryption keys and verified profile are still locked with your old passkey. Open them with another way you still have, and they'll move to your new passkey."
                : "Your encryption keys and verified profile are locked. Open them with a way you still have."}
            </p>
          </div>
          {errorAlert}
          {access ? (
            <VaultUnlockOptions
              methods={unlockMethodsFor(access, lostPasskey)}
              onUnlocked={handleUnlocked}
            />
          ) : null}
          <Button
            className="w-full"
            onClick={() => setPhase({ name: "fresh_start" })}
            type="button"
            variant="ghost"
          >
            I can't use any of these
          </Button>
        </div>
      );

    case "connect":
      return access ? (
        <ConnectCredentials
          access={access}
          onDone={(material, label) => finish(material, label)}
          vaultKey={phase.vaultKey}
        />
      ) : null;

    case "remove_lost":
      return (
        <RemoveLostPasskeys
          candidates={phase.candidates}
          onDone={() =>
            newPasskey
              ? finish(newPasskey, "your new passkey")
              : Promise.resolve()
          }
          onRemove={retirePasskey}
        />
      );

    case "fresh_start":
      return (
        <div className="space-y-4">
          <Alert variant="warning">
            <LockKeyhole />
            <AlertTitle>Your encrypted data can't be opened</AlertTitle>
            <AlertDescription>
              Your account is back, but your encryption keys and verified
              profile were locked with a sign-in method you no longer have.
              Zentity can't open them for you.
            </AlertDescription>
          </Alert>
          <p className="text-muted-foreground text-sm">
            You can start over with new encryption keys. Your current keys and
            verified profile will be deleted, and you'll need to verify your
            identity again.
          </p>
          {errorAlert}
          <div className="flex flex-col gap-2">
            <Button
              disabled={busy}
              onClick={asyncHandler(startOver)}
              variant="destructive"
            >
              {busy ? <Spinner aria-hidden="true" size="sm" /> : null}
              Start over with new keys
            </Button>
            {access &&
            hasVaultUnlockMethod(unlockMethodsFor(access, lostPasskey)) ? (
              <Button
                disabled={busy}
                onClick={() => setPhase({ name: "unlock" })}
                variant="ghost"
              >
                Back
              </Button>
            ) : (
              <Button
                disabled={busy}
                onClick={() => redirectTo("/dashboard")}
                variant="ghost"
              >
                Not now
              </Button>
            )}
          </div>
        </div>
      );

    case "done":
      return (
        <div className="space-y-4">
          <div className="space-y-1">
            <p className="flex items-center gap-2 font-medium">
              <Check className="size-4 text-success" />
              Your encrypted data is open
            </p>
            <p className="text-muted-foreground text-sm">
              We checked that {phase.credentialLabel} opens it.
            </p>
          </div>
          <ul className="space-y-1 text-sm" data-testid="recovered-secrets">
            {phase.opened.map((secretType) => (
              <li className="flex items-center gap-2" key={secretType}>
                <Check className="size-4 text-success" />
                {SECRET_LABELS[secretType]}
              </li>
            ))}
          </ul>
          <Button className="w-full" onClick={() => redirectTo("/dashboard")}>
            Go to dashboard
          </Button>
        </div>
      );

    default: {
      const _exhaustive: never = phase;
      return null;
    }
  }
}

function ConnectCredentials({
  access,
  vaultKey,
  onDone,
}: Readonly<{
  access: VaultAccess;
  vaultKey: VaultKey;
  onDone: (material: VaultCredentialMaterial, label: string) => Promise<void>;
}>) {
  const passwordId = useId();
  const [password, setPassword] = useState("");
  const [connected, setConnected] = useState<{
    ids: string[];
    last: { material: VaultCredentialMaterial; label: string } | null;
  }>({ ids: [], last: null });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const needsPassword = access.password !== null && !access.password.connected;
  const disconnectedPasskeys = access.passkeys.filter((p) => !p.connected);

  const connect = async (
    id: string,
    label: string,
    resolve: () => Promise<VaultCredentialMaterial>
  ) => {
    setBusy(id);
    setError(null);
    try {
      const material = await resolve();
      await addVaultCredential(vaultKey, material);
      await bindCredential(vaultKey, material).catch(reportRejection);
      setConnected((prev) => ({
        ids: [...prev.ids, id],
        last: { material, label },
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const connectPassword = () =>
    connect("password", "your password", async () => {
      const result = await authClient.opaque.verifyPassword({ password });
      if (!result.data || result.error) {
        throw new Error("That password is incorrect.");
      }
      return { type: "opaque", exportKey: result.data.exportKey };
    });

  const connectPasskey = (passkey: AccessPasskey) =>
    connect(passkey.credentialId, "your passkey", async () => {
      const prfSalt = generatePrfSalt();
      const { prfOutputs } = await evaluatePrf({
        credentialIdToSalt: { [passkey.credentialId]: prfSalt },
      });
      const prfOutput = prfOutputs.get(passkey.credentialId);
      if (!prfOutput) {
        throw new Error("That passkey didn't return the data needed.");
      }
      return {
        type: "passkey",
        credentialId: passkey.credentialId,
        prfOutput,
        prfSalt,
      };
    });

  const remaining =
    (needsPassword && !connected.ids.includes("password") ? 1 : 0) +
    disconnectedPasskeys.filter((p) => !connected.ids.includes(p.credentialId))
      .length;

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <p className="font-medium">Connect your sign-in methods</p>
        <p className="text-muted-foreground text-sm">
          These can sign you in but can't open your encrypted data yet.
        </p>
      </div>

      {error ? (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {needsPassword &&
        (connected.ids.includes("password") ? (
          <p className="flex items-center gap-2 text-sm">
            <Check className="size-4 text-success" />
            Password connected
          </p>
        ) : (
          <form
            className="space-y-2"
            onSubmit={(event) => {
              event.preventDefault();
              connectPassword().catch(reportRejection);
            }}
          >
            <Label htmlFor={passwordId}>Your password</Label>
            <div className="flex gap-2">
              <Input
                autoComplete="current-password"
                disabled={busy !== null}
                id={passwordId}
                onChange={(event) => setPassword(event.target.value)}
                type="password"
                value={password}
              />
              <Button
                disabled={busy !== null || !password}
                type="submit"
                variant="outline"
              >
                {busy === "password" ? (
                  <Spinner aria-hidden="true" size="sm" />
                ) : (
                  <KeyRound />
                )}
                Connect
              </Button>
            </div>
          </form>
        ))}

      {disconnectedPasskeys.map((passkey) =>
        connected.ids.includes(passkey.credentialId) ? (
          <p
            className="flex items-center gap-2 text-sm"
            key={passkey.credentialId}
          >
            <Check className="size-4 text-success" />
            {passkey.name || "Passkey"} connected
          </p>
        ) : (
          <Button
            className="w-full justify-start gap-3"
            disabled={busy !== null}
            key={passkey.credentialId}
            onClick={() => {
              connectPasskey(passkey).catch(reportRejection);
            }}
            variant="outline"
          >
            {busy === passkey.credentialId ? (
              <Spinner aria-hidden="true" size="sm" />
            ) : (
              <Fingerprint />
            )}
            Connect {passkey.name || "passkey"}
          </Button>
        )
      )}

      <Button
        className="w-full"
        disabled={busy !== null || connected.last === null}
        onClick={() => {
          if (connected.last) {
            onDone(connected.last.material, connected.last.label).catch(
              (err: unknown) =>
                setError(err instanceof Error ? err.message : String(err))
            );
          }
        }}
      >
        {remaining > 0 ? "Done for now" : "Done"}
      </Button>
    </div>
  );
}

function RemoveLostPasskeys({
  candidates,
  onRemove,
  onDone,
}: Readonly<{
  candidates: AccessPasskey[];
  onRemove: (passkey: AccessPasskey) => Promise<void>;
  onDone: () => Promise<void>;
}>) {
  const [removed, setRemoved] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const remove = async (passkey: AccessPasskey) => {
    setBusy(passkey.id);
    setError(null);
    try {
      await onRemove(passkey);
      setRemoved((prev) => [...prev, passkey.id]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <p className="font-medium">Remove passkeys you no longer have</p>
        <p className="text-muted-foreground text-sm">
          Your new passkey is connected. Remove the passkey you lost so it can't
          be used to sign in.
        </p>
      </div>
      {error ? (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <ul className="space-y-2">
        {candidates.map((passkey) => (
          <li
            className="flex items-center justify-between gap-2 rounded-lg border p-3 text-sm"
            key={passkey.id}
          >
            <span>{passkey.name || "Unnamed passkey"}</span>
            {removed.includes(passkey.id) ? (
              <span className="text-muted-foreground">Removed</span>
            ) : (
              <Button
                disabled={busy !== null}
                onClick={() => {
                  remove(passkey).catch(reportRejection);
                }}
                size="sm"
                variant="ghost"
              >
                {busy === passkey.id ? (
                  <Spinner aria-hidden="true" size="sm" />
                ) : null}
                Remove
              </Button>
            )}
          </li>
        ))}
      </ul>
      <Button
        className="w-full"
        disabled={busy !== null}
        onClick={() => {
          onDone().catch((err: unknown) =>
            setError(err instanceof Error ? err.message : String(err))
          );
        }}
      >
        Done
      </Button>
    </div>
  );
}
