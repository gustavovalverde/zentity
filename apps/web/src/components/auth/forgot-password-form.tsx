"use client";

import { useForm } from "@tanstack/react-form";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { toast } from "sonner";

/** Basic email format validation pattern */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const isEmail = (value: string) => EMAIL_PATTERN.test(value);

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
  const identifierId = useId();
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const form = useForm({
    defaultValues: {
      identifier: "",
    },
    onSubmit: async ({ value }) => {
      setIsLoading(true);
      setError(null);

      try {
        const result = await authClient.opaque.requestPasswordReset({
          identifier: value.identifier,
          redirectTo: "/reset-password",
        });

        if (result.error) {
          // Don't reveal if identifier exists or not (security)
          // Still show success message
        }

        toast.success("Check your email", {
          description: "If an account exists, we sent a reset link.",
        });
        router.push(
          `/forgot-password/sent?identifier=${encodeURIComponent(value.identifier)}`
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

  const validateIdentifier = (value: string) => {
    if (!value.trim()) {
      return "Email or recovery ID is required";
    }
    if (value.includes("@") && !isEmail(value)) {
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
          name="identifier"
          validators={{
            onBlur: ({ value }) => validateIdentifier(value),
            onSubmit: ({ value }) => validateIdentifier(value),
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
                <FieldLabel htmlFor={identifierId}>
                  Email or Recovery ID
                </FieldLabel>
                <Input
                  aria-invalid={isInvalid}
                  autoCapitalize="none"
                  autoComplete="username"
                  disabled={isLoading}
                  id={identifierId}
                  name={field.name}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                  placeholder="you@example.com or rec_abc123"
                  spellCheck={false}
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
