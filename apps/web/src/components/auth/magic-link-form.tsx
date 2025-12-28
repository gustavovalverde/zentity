"use client";

import { useForm } from "@tanstack/react-form";
import { Loader2, Mail } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Field,
  FieldControl,
  FieldLabel,
  FieldMessage,
} from "@/components/ui/tanstack-form";
import { signInSchema } from "@/features/auth/schemas/sign-in.schema";
import { authClient } from "@/lib/auth";
import { makeFieldValidator } from "@/lib/utils";

export function MagicLinkForm() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const form = useForm({
    defaultValues: {
      email: "",
    },
    onSubmit: async ({ value }) => {
      setIsSubmitting(true);
      setError(null);

      try {
        const result = await authClient.signIn.magicLink({
          email: value.email,
          callbackURL: "/dashboard",
        });

        if (result.error) {
          // Check if user doesn't exist (they need to sign up first with identity verification)
          if (
            result.error.message?.includes("user") ||
            result.error.message?.includes("not found")
          ) {
            setError(
              "No account found with this email. Please sign up first to complete identity verification.",
            );
          } else {
            setError(result.error.message || "Failed to send magic link");
          }
          setIsSubmitting(false);
          return;
        }

        // Redirect to confirmation page
        router.push(
          `/magic-link-sent?email=${encodeURIComponent(value.email)}`,
        );
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "An unexpected error occurred",
        );
        setIsSubmitting(false);
      }
    },
  });

  const validateEmail = makeFieldValidator(
    signInSchema.pick({ email: true }),
    "email",
    (value: string) => ({ email: value }),
  );

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        e.stopPropagation();
        form.handleSubmit();
      }}
      className="space-y-4"
    >
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <form.Field
        name="email"
        validators={{
          onBlur: ({ value }) => validateEmail(value),
          onSubmit: ({ value }) => validateEmail(value),
        }}
      >
        {(field) => (
          <Field
            name={field.name}
            errors={field.state.meta.errors as string[]}
            isTouched={field.state.meta.isTouched}
            isValidating={field.state.meta.isValidating}
          >
            <FieldLabel>Email</FieldLabel>
            <FieldControl>
              <Input
                type="email"
                placeholder="you@example.com"
                autoComplete="email"
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
                disabled={isSubmitting}
              />
            </FieldControl>
            <FieldMessage />
          </Field>
        )}
      </form.Field>

      <Button type="submit" className="w-full" disabled={isSubmitting}>
        {isSubmitting ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Sending link...
          </>
        ) : (
          <>
            <Mail className="mr-2 h-4 w-4" />
            Send Magic Link
          </>
        )}
      </Button>

      <p className="text-xs text-center text-muted-foreground">
        We'll send you a link to sign in without a password
      </p>
    </form>
  );
}
