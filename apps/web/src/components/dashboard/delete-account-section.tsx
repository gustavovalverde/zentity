"use client";

import { AlertTriangle, Loader2, Trash2 } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc/client";

interface DeleteAccountSectionProps {
  email: string;
}

export function DeleteAccountSection({ email }: DeleteAccountSectionProps) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [confirmEmail, setConfirmEmail] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);

  const isEmailMatch = confirmEmail.toLowerCase() === email.toLowerCase();

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
          <p className="mt-1 text-sm text-muted-foreground">
            Permanently delete your account and all associated data. This action
            cannot be undone.
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            Due to our privacy-first architecture, all your data including
            cryptographic commitments, encrypted information, and verification
            proofs will be permanently erased. This is GDPR-compliant by design
            - we cannot recover your data because we never stored it in a
            recoverable form.
          </p>

          <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
              <Button variant="destructive" className="mt-4">
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
                    <li>Encrypted biometric data</li>
                  </ul>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="confirm-email">
                    Type{" "}
                    <span className="font-mono font-semibold">{email}</span> to
                    confirm
                  </Label>
                  <Input
                    id="confirm-email"
                    type="email"
                    placeholder="Enter your email to confirm"
                    value={confirmEmail}
                    onChange={(e) => setConfirmEmail(e.target.value)}
                    disabled={isDeleting}
                  />
                </div>
              </div>

              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="outline" disabled={isDeleting}>
                    Cancel
                  </Button>
                </DialogClose>
                <Button
                  variant="destructive"
                  onClick={handleDelete}
                  disabled={!isEmailMatch || isDeleting}
                >
                  {isDeleting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Deleting...
                    </>
                  ) : (
                    <>
                      <Trash2 className="mr-2 h-4 w-4" />
                      Delete Forever
                    </>
                  )}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </CardContent>
    </Card>
  );
}
