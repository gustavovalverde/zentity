"use client";

import { Fingerprint, Mail } from "lucide-react";
import { useSyncExternalStore } from "react";

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
import {
  getPasskeyConfirmation,
  subscribePasskeyConfirmation,
} from "@/lib/auth/passkey/client";

const noConfirmation = () => null;

/**
 * Asks the user how to confirm a change the server refused until they sign
 * in again (`withPasskeyConfirmation`). The passkey prompt opens from the
 * button, so the browser sees it as the user's own action.
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
        <AlertDialogHeader>
          <AlertDialogTitle>Confirm it's you</AlertDialogTitle>
          <AlertDialogDescription>
            This change affects how you sign in to or recover your account. Use
            your passkey to continue.
            {request?.emailLinkTo
              ? ` If you don't have it, we can email a sign-in link to ${request.emailLinkTo}.`
              : null}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          {request?.emailLinkTo ? (
            <Button
              onClick={() => request.choose("email_link")}
              variant="outline"
            >
              <Mail />
              Email me a link
            </Button>
          ) : null}
          <Button onClick={() => request?.choose("passkey")}>
            <Fingerprint />
            Use passkey
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
