"use client";

import type { RecoveryOptions } from "@/lib/auth/recovery-factors";
import type { VaultKey } from "@/lib/privacy/secrets/vault";

import { FileKey, Fingerprint, KeyRound, Mail } from "lucide-react";
import { useId, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { WalletConfirmationButton } from "@/components/wallet-confirmation-button";
import { reportRejection } from "@/lib/async-handler";
import { authClient } from "@/lib/auth/auth-client";
import { proveRecoveryKey, signInWithPasskey } from "@/lib/auth/passkey/client";
import { parseRecoveryKey } from "@/lib/privacy/credentials/recovery-key";
import { unlockVaultKey } from "@/lib/privacy/secrets/vault";

type Entry = "password" | "recovery_key";

const PROOF_LABELS: Record<RecoveryOptions["proofs"][number], string> = {
  magic_link: "an email link",
  password: "your password",
  recovery_key: "your recovery key",
  wallet: "your wallet",
};

/** Opens the vault with what the user just entered, when it can. */
async function openVault(
  unlock: Parameters<typeof unlockVaultKey>[0],
  userId: string
): Promise<VaultKey | null> {
  try {
    return await unlockVaultKey(unlock, { userId });
  } catch {
    // The proof still counts; the vault opens later with another way.
    return null;
  }
}

/**
 * Asks a signed-in user who can't use their passkey for the proofs that
 * together confirm an account recovery: an email link, the password, a
 * wallet, or the recovery key. The password and the recovery key also open
 * the vault, so the user enters each only once.
 */
export function RecoveryProofs({
  options,
  email,
  userId,
  returnTo,
  onProved,
}: Readonly<{
  options: RecoveryOptions;
  email: string;
  userId: string;
  returnTo: string;
  onProved: (proof: {
    method: "passkey" | "password" | "recovery_key" | "wallet";
    vaultKey: VaultKey | null;
  }) => Promise<void> | void;
}>) {
  const [entry, setEntry] = useState<Entry | null>(null);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [linkSent, setLinkSent] = useState(false);
  const inputId = useId();

  const held = options.proofs;
  const canEmail = options.available.email && !held.includes("magic_link");
  const canPassword = options.available.password && !held.includes("password");
  const canRecoveryKey =
    options.available.recoveryKey && !held.includes("recovery_key");
  const canWallet = options.available.wallet && !held.includes("wallet");
  const nothingLeft = !(canEmail || canPassword || canRecoveryKey || canWallet);

  const run = async (id: string, prove: () => Promise<void>) => {
    setBusy(id);
    setError(null);
    try {
      await prove();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const proveEntry = () =>
    run(entry ?? "entry", async () => {
      if (entry === "password") {
        const result = await authClient.opaque.verifyPassword({
          password: value,
        });
        if (!result.data || result.error) {
          throw new Error("That password is incorrect.");
        }
        const vaultKey = await openVault(
          { type: "opaque", exportKey: result.data.exportKey },
          userId
        );
        setValue("");
        await onProved({ method: "password", vaultKey });
        return;
      }
      const recoveryKey = parseRecoveryKey(value);
      if (!recoveryKey) {
        throw new Error(
          "Enter all 24 words of your recovery key, separated by spaces."
        );
      }
      await proveRecoveryKey(recoveryKey, userId);
      const vaultKey = await openVault(
        { type: "recovery_key", recoveryKey },
        userId
      );
      recoveryKey.fill(0);
      setValue("");
      await onProved({ method: "recovery_key", vaultKey });
    });

  const sendLink = () =>
    run("email", async () => {
      const sent = await authClient.signIn.magicLink({
        email,
        callbackURL: returnTo,
      });
      if (sent?.error) {
        throw new Error("We couldn't send a sign-in link. Try again.");
      }
      setLinkSent(true);
    });

  const confirmWithPasskey = () =>
    run("passkey", async () => {
      const result = await signInWithPasskey();
      if (!result.ok) {
        throw new Error(result.message);
      }
      const signedInAs = (
        result.data as { user?: { id?: unknown } } | undefined
      )?.user?.id;
      if (signedInAs !== userId) {
        throw new Error(
          "That passkey belongs to another Zentity account, and you're now signed in to it. Sign in to the account you meant to recover, then try again."
        );
      }
      await onProved({ method: "passkey", vaultKey: null });
    });

  const heldText =
    held.length > 0
      ? `You confirmed with ${held.map((proof) => PROOF_LABELS[proof]).join(" and ")}. Confirm one more way to continue.`
      : "Confirm two ways you can recover your account, such as an email link and your recovery key.";

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm">{heldText}</p>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {linkSent ? (
        <Alert>
          <Mail />
          <AlertDescription>
            We sent a sign-in link to {email}. Open it on this device within 5
            minutes to continue.
          </AlertDescription>
        </Alert>
      ) : null}

      {entry ? (
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            proveEntry().catch(reportRejection);
          }}
        >
          <Label htmlFor={inputId}>
            {entry === "password" ? "Password" : "Recovery key"}
          </Label>
          {entry === "password" ? (
            <Input
              autoComplete="current-password"
              autoFocus
              disabled={busy !== null}
              id={inputId}
              onChange={(event) => setValue(event.target.value)}
              type="password"
              value={value}
            />
          ) : (
            <Textarea
              autoCapitalize="none"
              autoComplete="off"
              autoFocus
              disabled={busy !== null}
              id={inputId}
              onChange={(event) => setValue(event.target.value)}
              placeholder="Enter the 24 words, separated by spaces"
              rows={4}
              spellCheck={false}
              value={value}
            />
          )}
          <div className="flex justify-end gap-2">
            <Button
              disabled={busy !== null}
              onClick={() => {
                setEntry(null);
                setValue("");
              }}
              type="button"
              variant="ghost"
            >
              Back
            </Button>
            <Button disabled={busy !== null || !value} type="submit">
              {busy ? <Spinner aria-hidden="true" size="sm" /> : null}
              Confirm
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-col gap-2">
          {canRecoveryKey ? (
            <Button
              className="justify-start"
              disabled={busy !== null}
              onClick={() => setEntry("recovery_key")}
              variant="outline"
            >
              <FileKey />
              Use your recovery key
            </Button>
          ) : null}
          {canPassword ? (
            <Button
              className="justify-start"
              disabled={busy !== null}
              onClick={() => setEntry("password")}
              variant="outline"
            >
              <KeyRound />
              Use your password
            </Button>
          ) : null}
          {canEmail ? (
            <Button
              className="justify-start"
              disabled={busy !== null || linkSent}
              onClick={() => {
                sendLink().catch(reportRejection);
              }}
              variant="outline"
            >
              {busy === "email" ? (
                <Spinner aria-hidden="true" size="sm" />
              ) : (
                <Mail />
              )}
              Email me a sign-in link
            </Button>
          ) : null}
          {canWallet ? (
            <WalletConfirmationButton
              disabled={busy !== null}
              onConfirmed={() => onProved({ method: "wallet", vaultKey: null })}
              onError={setError}
            />
          ) : null}
          {options.hasPasskey ? (
            <Button
              className="justify-start"
              disabled={busy !== null}
              onClick={() => {
                confirmWithPasskey().catch(reportRejection);
              }}
              variant="ghost"
            >
              {busy === "passkey" ? (
                <Spinner aria-hidden="true" size="sm" />
              ) : (
                <Fingerprint />
              )}
              Use a passkey after all
            </Button>
          ) : null}
        </div>
      )}

      {nothingLeft && !entry ? (
        <Alert variant="warning">
          <AlertDescription>
            Your account has no other way left to confirm a recovery. Use a
            device that has your passkey. A password reset by email, or a wallet
            linked in the last 7 days, can't confirm a recovery.
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
