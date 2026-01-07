"use client";

import { useForm } from "@tanstack/react-form";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

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
import { signIn } from "@/lib/auth/auth-client";
import { prepareForNewSession } from "@/lib/auth/session-manager";
import { redirectTo } from "@/lib/utils/navigation";
import { makeFieldValidator } from "@/lib/utils/validation";

export function SignInForm() {
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const form = useForm({
    defaultValues: {
      email: "",
      password: "",
    },
    onSubmit: async ({ value }) => {
      setIsLoading(true);
      setError(null);

      // Clear any stale caches from previous session
      prepareForNewSession();

      try {
        const result = await signIn.email({
          email: value.email,
          password: value.password,
        });

        if (result.error) {
          const errorMsg = result.error.message || "Invalid email or password";
          setError(errorMsg);
          toast.error("Sign in failed", { description: errorMsg });
          return;
        }

        toast.success("Signed in successfully!");
        redirectTo("/dashboard");
      } catch {
        const errorMsg = "An unexpected error occurred. Please try again.";
        setError(errorMsg);
        toast.error("Sign in failed", { description: errorMsg });
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

  const validateField = (fieldName: "email" | "password", value: string) => {
    const validator = makeFieldValidator(
      signInSchema,
      fieldName,
      (val: string) => ({
        email: fieldName === "email" ? val : form.getFieldValue("email"),
        password:
          fieldName === "password" ? val : form.getFieldValue("password"),
      })
    );

    return validator(value);
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
            onBlur: ({ value }) => validateField("email", value),
            onSubmit: ({ value }) => validateField("email", value),
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

        <form.Field
          name="password"
          validators={{
            onBlur: ({ value }) => validateField("password", value),
            onSubmit: ({ value }) => validateField("password", value),
          }}
        >
          {(field) => (
            <Field
              errors={field.state.meta.errors as string[]}
              isTouched={field.state.meta.isTouched}
              isValidating={field.state.meta.isValidating}
              name={field.name}
            >
              <div className="flex items-center justify-between">
                <FieldLabel>Password</FieldLabel>
                <Link
                  className="text-muted-foreground text-xs hover:text-primary hover:underline"
                  href="/forgot-password"
                >
                  Forgot password?
                </Link>
              </div>
              <FieldControl>
                <Input
                  autoComplete="current-password"
                  disabled={isLoading}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                  placeholder="Enter your password"
                  type="password"
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
            Signing in...
          </>
        ) : (
          "Sign In"
        )}
      </Button>
    </form>
  );
}
