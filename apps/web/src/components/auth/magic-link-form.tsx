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
import { authClient } from "@/lib/auth/auth-client";
import { makeFieldValidator } from "@/lib/utils/validation";

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
              "No account found with this email. Please sign up first to complete identity verification."
            );
          } else {
            setError(result.error.message || "Failed to send magic link");
          }
          setIsSubmitting(false);
          return;
        }

        // Redirect to confirmation page
        router.push(
          `/magic-link-sent?email=${encodeURIComponent(value.email)}`
        );
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "An unexpected error occurred"
        );
        setIsSubmitting(false);
      }
    },
  });

  const validateEmail = makeFieldValidator(
    signInSchema.pick({ email: true }),
    "email",
    (value: string) => ({ email: value })
  );

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        e.stopPropagation();
        form.handleSubmit();
      }}
    >
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

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
                disabled={isSubmitting}
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

      <Button className="w-full" disabled={isSubmitting} type="submit">
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

      <p className="text-center text-muted-foreground text-xs">
        We'll send you a link to sign in without a password
      </p>
    </form>
  );
}
