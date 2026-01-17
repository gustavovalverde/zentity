"use client";

import { AlertTriangle, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

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
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { trpc } from "@/lib/trpc/client";

interface DeleteAccountSectionProps {
  email: string;
}

export function DeleteAccountSection({
  email,
}: Readonly<DeleteAccountSectionProps>) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [confirmEmail, setConfirmEmail] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);

  const isEmailMatch = confirmEmail.toLowerCase() === email.toLowerCase();
  const emailError =
    confirmEmail.trim().length > 0 && !isEmailMatch
      ? "Email does not match"
      : null;

  const handleDelete = async () => {
    if (!isEmailMatch) {
      toast.error("Email does not match");
      return;
    }

    setIsDeleting(true);

    try {
      await trpc.account.deleteAccount.mutate({ confirmEmail });

      toast.success("Account deleted", {
        description:
          "Your account and all associated data have been permanently deleted.",
      });

      // Redirect to home page after deletion
      setIsOpen(false);
      router.push("/");
      router.refresh();
    } catch (error) {
      toast.error("Failed to delete account", {
        description:
          error instanceof Error ? error.message : "Please try again",
      });
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <Card className="border-destructive/50">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-destructive">
          <AlertTriangle className="h-5 w-5" />
          Danger Zone
        </CardTitle>
        <CardDescription>
          Irreversible actions that affect your account
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
          <h4 className="font-medium">Delete Account</h4>
          <p className="mt-1 text-muted-foreground text-sm">
            Permanently delete your account and all associated data. This action
            cannot be undone.
          </p>
          <p className="mt-2 text-muted-foreground text-sm">
            Due to our privacy-first architecture, we do not store plaintext
            PII. Your encrypted profile data is passkey-sealed, and your email
            is stored only for authentication. Deleting your account removes
            encrypted data, commitments, proofs, and credentials.
          </p>

          <Dialog onOpenChange={setIsOpen} open={isOpen}>
            <DialogTrigger asChild>
              <Button className="mt-4" variant="destructive">
                <Trash2 className="mr-2 h-4 w-4" />
                Delete My Account
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-destructive">
                  <AlertTriangle className="h-5 w-5" />
                  Delete Account Permanently
                </DialogTitle>
                <DialogDescription>
                  This action is permanent and cannot be undone. All your data
                  will be irreversibly deleted.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 py-4">
                <div className="rounded-lg bg-destructive/10 p-3 text-sm">
                  <p className="font-medium text-destructive">
                    The following will be permanently deleted:
                  </p>
                  <ul className="mt-2 list-inside list-disc space-y-1 text-muted-foreground">
                    <li>Your account and login credentials</li>
                    <li>All identity verification data</li>
                    <li>Cryptographic commitments and salts</li>
                    <li>Zero-knowledge proofs</li>
                    <li>Encrypted verification attributes (e.g., liveness)</li>
                  </ul>
                </div>

                <div className="space-y-2">
                  <FieldGroup>
                    <Field data-invalid={Boolean(emailError)}>
                      <FieldLabel htmlFor="confirm-email">
                        Type{" "}
                        <span className="font-mono font-semibold">{email}</span>{" "}
                        to confirm
                      </FieldLabel>
                      <Input
                        aria-invalid={Boolean(emailError)}
                        autoCapitalize="none"
                        autoComplete="email"
                        disabled={isDeleting}
                        id="confirm-email"
                        inputMode="email"
                        name="confirmEmail"
                        onChange={(e) => setConfirmEmail(e.target.value)}
                        placeholder="Enter your email to confirm"
                        spellCheck={false}
                        type="email"
                        value={confirmEmail}
                      />
                      <FieldError>{emailError}</FieldError>
                    </Field>
                  </FieldGroup>
                </div>
              </div>

              <DialogFooter>
                <DialogClose asChild>
                  <Button disabled={isDeleting} variant="outline">
                    Cancel
                  </Button>
                </DialogClose>
                <Button
                  disabled={!isEmailMatch || isDeleting}
                  onClick={handleDelete}
                  variant="destructive"
                >
                  {isDeleting ? (
                    <Spinner aria-hidden="true" className="mr-2" />
                  ) : (
                    <Trash2 className="mr-2 h-4 w-4" />
                  )}
                  Delete Forever
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </CardContent>
    </Card>
  );
}
