"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { authClient, useSession } from "@/lib/auth/auth-client";

interface TwoFactorCardProps {
  hasPassword?: boolean;
}

export function TwoFactorCard({ hasPassword = false }: TwoFactorCardProps) {
  const { data: sessionData, isPending } = useSession();
  const [showDialog, setShowDialog] = useState(false);

  const isTwoFactorEnabled = sessionData?.user?.twoFactorEnabled;

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Two-factor authentication</CardTitle>
          <CardDescription>
            Add an authenticator app for extra security when signing in. Once
            enabled, you can also use it as a recovery guardian.
          </CardDescription>
          <CardAction>
            <Button
              disabled={isPending}
              onClick={() => setShowDialog(true)}
              variant="outline"
            >
              {isTwoFactorEnabled ? "Disable" : "Enable"}
            </Button>
          </CardAction>
        </CardHeader>
      </Card>

      <TwoFactorDialog
        hasPassword={hasPassword}
        isTwoFactorEnabled={!!isTwoFactorEnabled}
        onOpenChange={setShowDialog}
        open={showDialog}
      />
    </>
  );
}

interface TwoFactorDialogProps {
  hasPassword: boolean;
  isTwoFactorEnabled: boolean;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}

function TwoFactorDialog({
  hasPassword,
  isTwoFactorEnabled,
  onOpenChange,
  open,
}: TwoFactorDialogProps) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const getDialogDescription = () => {
    if (isTwoFactorEnabled) {
      return "Enter your password to disable two-factor authentication.";
    }
    if (hasPassword) {
      return "Enter your password to continue setting up two-factor authentication.";
    }
    return "Continue to set up two-factor authentication.";
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (hasPassword && !password.trim()) {
      setError("Password is required");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      if (isTwoFactorEnabled) {
        await authClient.twoFactor.disable({
          ...(hasPassword ? { password: password.trim() } : {}),
          fetchOptions: { throw: true },
        });
        onOpenChange(false);
        setPassword("");
      } else {
        const response = await authClient.twoFactor.enable({
          ...(hasPassword ? { password: password.trim() } : {}),
          fetchOptions: { throw: true },
        });

        onOpenChange(false);
        setPassword("");

        if (response.totpURI) {
          globalThis.window.location.assign(
            `/verify-2fa?totpURI=${encodeURIComponent(response.totpURI)}`
          );
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setPassword("");
      setError(null);
    }
    onOpenChange(nextOpen);
  };

  const renderFormContent = () => {
    if (hasPassword) {
      return (
        <Field data-invalid={Boolean(error)}>
          <FieldLabel>Password</FieldLabel>
          <Input
            autoComplete="current-password"
            disabled={isSubmitting}
            onChange={(event) => {
              setPassword(event.target.value);
              setError(null);
            }}
            placeholder="Enter your password"
            type="password"
            value={password}
          />
          <FieldError>{error}</FieldError>
        </Field>
      );
    }
    if (error) {
      return <p className="text-destructive text-sm">{error}</p>;
    }
    return null;
  };

  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isTwoFactorEnabled
              ? "Disable two-factor authentication"
              : "Enable two-factor authentication"}
          </DialogTitle>
          <DialogDescription>{getDialogDescription()}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <FieldGroup className="py-4">{renderFormContent()}</FieldGroup>

          <DialogFooter>
            <Button disabled={isSubmitting} type="submit">
              {isSubmitting ? (
                <Spinner aria-hidden="true" className="mr-2" />
              ) : null}
              {isTwoFactorEnabled ? "Disable" : "Continue"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
