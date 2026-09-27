"use client";

import type { VaultAccess } from "@/lib/privacy/secrets/vault-access";

import { LockKeyhole, ShieldAlert, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

type Notice =
  | { kind: "locked" }
  | { kind: "disconnected" }
  | { kind: "single"; onlyWallet: boolean };

function resolveNotice(access: VaultAccess): Notice | null {
  if (access.unlockingCount === 0) {
    return { kind: "locked" };
  }
  const hasDisconnected =
    (access.password !== null && !access.password.connected) ||
    access.passkeys.some((passkey) => !passkey.connected);
  if (hasDisconnected) {
    return { kind: "disconnected" };
  }
  if (access.unlockingCount === 1) {
    return { kind: "single", onlyWallet: Boolean(access.wallet?.connected) };
  }
  return null;
}

function dismissKey(access: VaultAccess, notice: Notice): string {
  return `zentity:vault-notice:${access.secretId}:${notice.kind}`;
}

function readDismissed(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function writeDismissed(key: string) {
  try {
    localStorage.setItem(key, "1");
  } catch {
    // Storage unavailable: the notice returns on the next visit.
  }
}

/**
 * One inline notice about how the user can open their vault: a sign-in
 * method that can't open it yet, or a single way in with no backup.
 */
export function VaultAccessNotice({
  access,
  place,
}: Readonly<{ access: VaultAccess | null; place: "dashboard" | "settings" }>) {
  const notice = access ? resolveNotice(access) : null;
  const key = access && notice ? dismissKey(access, notice) : null;
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    setDismissed(key ? readDismissed(key) : true);
  }, [key]);

  if (!(notice && key) || dismissed) {
    return null;
  }

  const dismiss = () => {
    writeDismissed(key);
    setDismissed(true);
  };

  if (notice.kind === "single") {
    return (
      <Alert variant="info">
        <ShieldAlert />
        <AlertTitle>Add a backup way to open your encrypted data</AlertTitle>
        <AlertDescription className="space-y-3">
          <p>
            {notice.onlyWallet
              ? "Your wallet is the only way to open your encryption keys and verified profile, and wallet signatures can change after a wallet update. Save a recovery key, or add a passkey or password."
              : "You have one way to open your encryption keys and verified profile. If you lose it, they can't be recovered. Add a passkey on another device, a password, or save a recovery key."}
          </p>
          <div className="flex gap-2">
            {place === "dashboard" ? (
              <Button asChild size="sm" variant="outline">
                <Link href="/dashboard/settings">Add a backup</Link>
              </Button>
            ) : null}
            <Button onClick={dismiss} size="sm" variant="ghost">
              <X />
              Dismiss
            </Button>
          </div>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Alert variant="warning">
      <LockKeyhole />
      <AlertTitle>
        {notice.kind === "locked"
          ? "Your encrypted data is locked"
          : "A sign-in method can't open your encrypted data"}
      </AlertTitle>
      <AlertDescription className="space-y-3">
        <p>
          {notice.kind === "locked"
            ? "None of your current sign-in methods can open your encryption keys and verified profile."
            : "You can sign in with it, but it can't open your encryption keys and verified profile yet. Connect it using a way you already have."}
        </p>
        <div className="flex gap-2">
          <Button asChild size="sm" variant="outline">
            <Link href="/recovery/vault">
              {notice.kind === "locked" ? "See your options" : "Connect"}
            </Link>
          </Button>
          <Button onClick={dismiss} size="sm" variant="ghost">
            <X />
            Dismiss
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}
