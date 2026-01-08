"use client";

import { useForm } from "@tanstack/react-form";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { toast } from "sonner";

/** Basic email format validation pattern */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { authClient } from "@/lib/auth/auth-client";

export function ForgotPasswordForm() {
  const router = useRouter();
  const emailId = useId();
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const form = useForm({
    defaultValues: {
      email: "",
    },
    onSubmit: async ({ value }) => {
      setIsLoading(true);
      setError(null);

      try {
        const result = await authClient.requestPasswordReset({
          email: value.email,
          redirectTo: "/reset-password",
        });

        if (result.error) {
          // Don't reveal if email exists or not (security)
          // Still show success message
        }

        toast.success("Check your email", {
          description: "If an account exists, we sent a password reset link.",
        });
        router.push(
          `/forgot-password/sent?email=${encodeURIComponent(value.email)}`
        );
      } catch {
        setError("An unexpected error occurred. Please try again.");
        toast.error("Request failed");
      } finally {
        setIsLoading(false);
      }
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
    form.handleSubmit();
  };

  const validateEmail = (value: string) => {
    if (!value) {
      return "Email is required";
    }
    if (!EMAIL_PATTERN.test(value)) {
      return "Invalid email address";
    }
    return;
  };

  return (
    <form className="space-y-6" onSubmit={handleSubmit}>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <FieldGroup>
        <form.Field
          name="email"
          validators={{
            onBlur: ({ value }) => validateEmail(value),
            onSubmit: ({ value }) => validateEmail(value),
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
                <FieldLabel htmlFor={emailId}>Email</FieldLabel>
                <Input
                  aria-invalid={isInvalid}
                  autoCapitalize="none"
                  autoComplete="email"
                  disabled={isLoading}
                  id={emailId}
                  inputMode="email"
                  name={field.name}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                  placeholder="you@example.com"
                  spellCheck={false}
                  type="email"
                  value={field.state.value}
                />
                <FieldError>{errorMessage}</FieldError>
              </Field>
            );
          }}
        </form.Field>
      </FieldGroup>

      <Button className="w-full" disabled={isLoading} type="submit">
        {isLoading ? <Spinner aria-hidden="true" className="mr-2" /> : null}
        Send Reset Link
      </Button>
    </form>
  );
}
