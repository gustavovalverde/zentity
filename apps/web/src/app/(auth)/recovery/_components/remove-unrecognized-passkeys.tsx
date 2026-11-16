"use client";

import { Check, LogOut, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { reportRejection } from "@/lib/async-handler";
import { authClient } from "@/lib/auth/auth-client";
import { listUserPasskeys } from "@/lib/auth/passkey/client";
import { redirectTo } from "@/lib/auth/redirect";
import { formatDate } from "@/lib/date-format";
import { removePasskey } from "@/lib/privacy/secrets/vault";
import { trpc } from "@/lib/trpc/client";

interface ListedPasskey {
  createdAt?: string | Date | null | undefined;
  credentialID: string;
  id: string;
  name?: string | null | undefined;
}

/**
 * Lets a user who confirmed it's them remove passkeys they don't recognize,
 * including the last one after an account recovery, and sign out every
 * other device. A passkey they didn't add means their password or a session
 * leaked, so the page also points to the password.
 */
export function RemoveUnrecognizedPasskeys({
  hasPassword,
}: Readonly<{ hasPassword: boolean }>) {
  const [passkeys, setPasskeys] = useState<ListedPasskey[] | null>(null);
  const [connected, setConnected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [signedOutOthers, setSignedOutOthers] = useState(false);

  const load = useCallback(async () => {
    const [listed, access] = await Promise.all([
      listUserPasskeys(),
      trpc.secrets.access.query().catch(() => null),
    ]);
    setPasskeys((listed.data as ListedPasskey[] | null) ?? []);
    setConnected(
      new Set(
        (access?.passkeys ?? [])
          .filter((passkey) => passkey.connected)
          .map((passkey) => passkey.credentialId)
      )
    );
  }, []);

  useEffect(() => {
    load().catch((err: unknown) =>
      setError(err instanceof Error ? err.message : String(err))
    );
  }, [load]);

  const remove = async (passkey: ListedPasskey) => {
    setBusy(passkey.id);
    setError(null);
    try {
      const result = await removePasskey({
        id: passkey.id,
        credentialId: passkey.credentialID,
        opensVault: connected.has(passkey.credentialID),
      });
      if (result.error) {
        throw new Error(
          result.error.message || "Couldn't remove that passkey."
        );
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const signOutOthers = async () => {
    setBusy("sessions");
    setError(null);
    try {
      const result = await authClient.revokeOtherSessions();
      if (result.error) {
        throw new Error(
          result.error.message || "Couldn't sign out your other devices."
        );
      }
      setSignedOutOthers(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <p className="font-medium">Remove passkeys you don't recognize</p>
        <p className="text-muted-foreground text-sm">
          A passkey you didn't add can sign in and approve requests as you.
        </p>
      </div>

      {error ? (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {passkeys === null ? (
        <div className="flex justify-center py-4">
          <Spinner className="size-5 text-muted-foreground" />
        </div>
      ) : (
        <ul className="space-y-2" data-testid="account-passkeys">
          {passkeys.length === 0 ? (
            <li className="text-muted-foreground text-sm">
              Your account has no passkeys.
            </li>
          ) : null}
          {passkeys.map((passkey) => (
            <li
              className="flex items-center justify-between gap-2 rounded-lg border p-3 text-sm"
              key={passkey.id}
            >
              <span>
                {passkey.name || "Unnamed passkey"}
                <span className="block text-muted-foreground text-xs">
                  Added {formatDate(passkey.createdAt, "on an unknown date")}
                </span>
              </span>
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
            </li>
          ))}
        </ul>
      )}

      <div className="space-y-2 rounded-lg border p-3">
        <p className="text-sm">
          Sign out every other device. Agent requests waiting for your approval
          will be denied.
        </p>
        {signedOutOthers ? (
          <p className="flex items-center gap-2 text-sm">
            <Check className="size-4 text-success" />
            Other devices are signed out
          </p>
        ) : (
          <Button
            disabled={busy !== null}
            onClick={() => {
              signOutOthers().catch(reportRejection);
            }}
            size="sm"
            variant="outline"
          >
            {busy === "sessions" ? (
              <Spinner aria-hidden="true" size="sm" />
            ) : (
              <LogOut />
            )}
            Sign out other devices
          </Button>
        )}
      </div>

      {hasPassword ? (
        <p className="text-muted-foreground text-sm">
          Someone may know your password.{" "}
          <Link
            className="font-medium text-primary hover:underline"
            href="/dashboard/settings"
          >
            Change it in Settings
          </Link>
          .
        </p>
      ) : null}

      <Button className="w-full" onClick={() => redirectTo("/dashboard")}>
        Done
      </Button>
    </div>
  );
}
