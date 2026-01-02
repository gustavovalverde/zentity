"use client";

import { useForm } from "@tanstack/react-form";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

/** Basic email format validation pattern */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Field,
  FieldControl,
  FieldLabel,
  FieldMessage,
} from "@/components/ui/tanstack-form";
import { authClient } from "@/lib/auth/auth-client";

export function ForgotPasswordForm() {
  const router = useRouter();
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

      <div className="space-y-4">
        <form.Field
          name="email"
          validators={{
            onBlur: ({ value }) => validateEmail(value),
            onSubmit: ({ value }) => validateEmail(value),
          }}
        >
          {(field) => (
            <Field
              errors={field.state.meta.errors as string[]}
              isTouched={field.state.meta.isTouched}
              isValidating={field.state.meta.isValidating}
              name={field.name}
            >
              <FieldLabel>Email</FieldLabel>
              <FieldControl>
                <Input
                  autoComplete="email"
                  disabled={isLoading}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                  placeholder="you@example.com"
                  type="email"
                  value={field.state.value}
                />
              </FieldControl>
              <FieldMessage />
            </Field>
          )}
        </form.Field>
      </div>

      <Button className="w-full" disabled={isLoading} type="submit">
        {isLoading ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Sending...
          </>
        ) : (
          "Send Reset Link"
        )}
      </Button>
    </form>
  );
}
