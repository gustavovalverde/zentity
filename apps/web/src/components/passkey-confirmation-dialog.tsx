"use client";

import type { RecoveryProof } from "@/lib/auth/recovery-factors";

import { FileKey, Fingerprint, KeyRound, Mail } from "lucide-react";
import dynamic from "next/dynamic";
import { useId, useState, useSyncExternalStore } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import {
  getPasskeyConfirmation,
  type PasskeyConfirmationRequest,
  subscribePasskeyConfirmation,
} from "@/lib/auth/passkey/client";

const noConfirmation = () => null;

// Loaded only when a wallet can confirm, so other pages skip the wallet code.
const WalletConfirmationButton = dynamic(
  () =>
    import("@/components/wallet-confirmation-button").then(
      (module) => module.WalletConfirmationButton
    ),
  { ssr: false }
);

const PROOF_LABELS: Record<RecoveryProof, string> = {
  magic_link: "an email link",
  password: "your password",
  recovery_key: "your recovery key",
  wallet: "your wallet",
};

function heldSummary(held: RecoveryProof[]): string | null {
  if (held.length === 0) {
    return null;
  }
  const labels = held.map((proof) => PROOF_LABELS[proof]).join(" and ");
  return `You confirmed with ${labels}. Without your passkey, confirm one more way to finish.`;
}

/**
 * Asks the user how to confirm a change the server refused until they sign
 * in again (`withPasskeyConfirmation`): with a passkey, or, without one, with
 * the ways that together confirm an account recovery. The passkey prompt
 * opens from the button, so the browser sees it as the user's own action.
 */
export function PasskeyConfirmationDialog() {
  const request = useSyncExternalStore(
    subscribePasskeyConfirmation,
    getPasskeyConfirmation,
    noConfirmation
  );

  return (
    <AlertDialog
      onOpenChange={(open) => {
        if (!open) {
          request?.choose("cancel");
        }
      }}
      open={request !== null}
    >
      <AlertDialogContent>
        {request ? (
          <ConfirmationOptions key={request.id} request={request} />
        ) : null}
      </AlertDialogContent>
    </AlertDialog>
  );
}

function ConfirmationOptions({
  request,
}: Readonly<{ request: PasskeyConfirmationRequest }>) {
  const [entry, setEntry] = useState<"password" | "recovery_key" | null>(null);
  const [value, setValue] = useState("");
  const [walletError, setWalletError] = useState<string | null>(null);
  const inputId = useId();
  const held = heldSummary(request.held);
  const recoveryChoices = Boolean(
    request.emailLinkTo ||
      request.password ||
      request.recoveryKey ||
      request.wallet
  );
  const error = walletError ?? request.error;

  const submit = () => {
    if (!value) {
      return;
    }
    request.choose(
      entry === "password" ? { password: value } : { recoveryKey: value }
    );
  };

  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle>Confirm it's you</AlertDialogTitle>
        <AlertDialogDescription>
          {held ??
            "This change affects how you sign in to or recover your account. Use your passkey to continue."}
        </AlertDialogDescription>
      </AlertDialogHeader>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {entry ? (
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <Label htmlFor={inputId}>
            {entry === "password" ? "Password" : "Recovery key"}
          </Label>
          {entry === "password" ? (
            <Input
              autoComplete="current-password"
              autoFocus
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
              onClick={() => {
                setEntry(null);
                setValue("");
              }}
              type="button"
              variant="ghost"
            >
              Back
            </Button>
            <Button disabled={!value} type="submit">
              Confirm
            </Button>
          </div>
        </form>
      ) : (
        <>
          {recoveryChoices ? (
            <div className="space-y-2">
              <Separator />
              <p className="text-muted-foreground text-sm">
                Can't use your passkey?
                {request.emailLinkTo
                  ? ` We can email a sign-in link to ${request.emailLinkTo}.`
                  : null}
              </p>
              <div className="flex flex-col gap-2">
                {request.emailLinkTo ? (
                  <Button
                    className="justify-start"
                    onClick={() => request.choose("email_link")}
                    variant="outline"
                  >
                    <Mail />
                    Email me a link
                  </Button>
                ) : null}
                {request.password ? (
                  <Button
                    className="justify-start"
                    onClick={() => setEntry("password")}
                    variant="outline"
                  >
                    <KeyRound />
                    Use your password
                  </Button>
                ) : null}
                {request.recoveryKey ? (
                  <Button
                    className="justify-start"
                    onClick={() => setEntry("recovery_key")}
                    variant="outline"
                  >
                    <FileKey />
                    Use your recovery key
                  </Button>
                ) : null}
                {request.wallet ? (
                  <WalletConfirmationButton
                    onConfirmed={() => request.choose("wallet_confirmed")}
                    onError={setWalletError}
                  />
                ) : null}
              </div>
            </div>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button onClick={() => request.choose("passkey")}>
              <Fingerprint />
              Use passkey
            </Button>
          </AlertDialogFooter>
        </>
      )}
    </>
  );
}
