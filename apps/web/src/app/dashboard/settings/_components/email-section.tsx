"use client";

import { useForm } from "@tanstack/react-form";
import { CheckCircle2, Mail, MailPlus, Pencil } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { InputGroup, InputGroupInput } from "@/components/ui/input-group";
import { Redacted } from "@/components/ui/redacted";
import { Spinner } from "@/components/ui/spinner";
import { asyncHandler, reportRejection } from "@/lib/async-handler";
import { authClient, useSession } from "@/lib/auth/auth-client";

const SYNTHETIC_EMAIL_DOMAINS = ["anon.zentity.app", "wallet.zentity.app"];

function isSyntheticEmail(email: string): boolean {
  const domain = email.split("@")[1];
  return domain !== undefined && SYNTHETIC_EMAIL_DOMAINS.includes(domain);
}

type EmailState = "synthetic" | "unverified" | "verified";

function getEmailState(email: string, emailVerified: boolean): EmailState {
  if (isSyntheticEmail(email)) {
    return "synthetic";
  }
  if (emailVerified) {
    return "verified";
  }
  return "unverified";
}

function EmailForm({
  action,
  onDone,
}: Readonly<{
  action: "add" | "change";
  onDone: () => void;
}>) {
  const emailId = useId();
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const form = useForm({
    defaultValues: { newEmail: "" },
    onSubmit: async ({ value }) => {
      setIsLoading(true);
      setError(null);

      try {
        const result = await authClient.changeEmail({
          newEmail: value.newEmail,
          callbackURL: "/dashboard/settings?tab=profile",
        });

        if (result.error) {
          const message =
            result.error.message ?? "Failed to update email. Please try again.";
          setError(message);
          return;
        }

        toast.success(
          action === "add"
            ? "Verification email sent"
            : "Email change initiated",
          {
            description: `Check ${value.newEmail} for a verification link.`,
          }
        );
        form.reset();
        onDone();
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "An unexpected error occurred";
        setError(message);
      } finally {
        setIsLoading(false);
      }
    },
  });

  const handleSubmit: React.SubmitEventHandler<HTMLFormElement> = (e) => {
    e.preventDefault();
    e.stopPropagation();
    form.handleSubmit().catch(reportRejection);
  };

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <form.Field
        name="newEmail"
        validators={{
          onSubmit: ({ value }) => {
            if (!value.trim()) {
              return "Email is required";
            }
            if (!value.includes("@")) {
              return "Enter a valid email address";
            }
            return undefined;
          },
        }}
      >
        {(field) => {
          const isInvalid =
            field.state.meta.isTouched && !field.state.meta.isValid;
          const errorMessage = isInvalid
            ? (field.state.meta.errors?.[0] as string | undefined)
            : undefined;
          return (
            <Field data-invalid={isInvalid}>
              <FieldLabel htmlFor={emailId}>
                {action === "add" ? "Email Address" : "New Email Address"}
              </FieldLabel>
              <InputGroup>
                <InputGroupInput
                  aria-invalid={isInvalid}
                  autoComplete="email"
                  disabled={isLoading}
                  id={emailId}
                  name={field.name}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                  placeholder="you@example.com"
                  type="email"
                  value={field.state.value}
                />
              </InputGroup>
              <FieldError>{errorMessage}</FieldError>
            </Field>
          );
        }}
      </form.Field>

      <div className="flex gap-2">
        <Button disabled={isLoading} type="submit">
          {isLoading ? <Spinner aria-hidden="true" className="mr-2" /> : null}
          {action === "add" ? "Add Email" : "Change Email"}
        </Button>
        <Button
          disabled={isLoading}
          onClick={onDone}
          type="button"
          variant="ghost"
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}

export function EmailSection() {
  const { data: sessionData } = useSession();
  const [showForm, setShowForm] = useState(false);
  const [resending, setResending] = useState(false);

  const email = sessionData?.user?.email ?? "";
  const emailVerified = sessionData?.user?.emailVerified ?? false;
  const state = getEmailState(email, emailVerified);

  const handleResend = async () => {
    setResending(true);
    try {
      await authClient.sendVerificationEmail({
        email,
        callbackURL: "/dashboard",
      });
      toast.success("Verification email sent", {
        description: "Check your inbox for a verification link.",
      });
    } catch {
      toast.error("Failed to send verification email");
    } finally {
      setResending(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mail className="h-5 w-5" />
          Email Address
        </CardTitle>
        <CardDescription>
          {state === "synthetic"
            ? "Add an email address to receive notifications and enable account recovery."
            : "Manage your email address and verification status."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {showForm ? (
          <EmailForm
            action={state === "synthetic" ? "add" : "change"}
            onDone={() => setShowForm(false)}
          />
        ) : (
          <div className="space-y-3">
            {state === "synthetic" ? (
              <div className="flex items-center gap-3">
                <p className="text-muted-foreground text-sm">
                  No email address on file.
                </p>
                <Button
                  onClick={() => setShowForm(true)}
                  size="sm"
                  variant="outline"
                >
                  <MailPlus className="mr-2 h-4 w-4" />
                  Add Email
                </Button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-medium text-sm">
                  <Redacted>{email}</Redacted>
                </span>
                {state === "verified" ? (
                  <Badge variant="success">
                    <CheckCircle2 className="mr-1 h-3 w-3" />
                    Verified
                  </Badge>
                ) : (
                  <Badge variant="warning">Unverified</Badge>
                )}

                <div className="ml-auto flex gap-2">
                  {state === "unverified" ? (
                    <Button
                      disabled={resending}
                      onClick={asyncHandler(handleResend)}
                      size="sm"
                      variant="outline"
                    >
                      {resending ? (
                        <Spinner
                          aria-hidden="true"
                          className="mr-2"
                          size="sm"
                        />
                      ) : null}
                      Resend Verification
                    </Button>
                  ) : null}
                  <Button
                    onClick={() => setShowForm(true)}
                    size="sm"
                    variant="ghost"
                  >
                    <Pencil className="mr-2 h-4 w-4" />
                    Change
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
