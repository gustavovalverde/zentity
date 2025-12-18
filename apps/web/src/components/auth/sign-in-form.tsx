"use client";

import { useForm } from "@tanstack/react-form";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
import { signIn } from "@/lib/auth";
import { makeFieldValidator } from "@/lib/utils";

export function SignInForm() {
  const router = useRouter();
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
        router.push("/dashboard");
        router.refresh();
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
      }),
    );

    return validator(value);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

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
                  disabled={isLoading}
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  onBlur={field.handleBlur}
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
              name={field.name}
              errors={field.state.meta.errors as string[]}
              isTouched={field.state.meta.isTouched}
              isValidating={field.state.meta.isValidating}
            >
              <div className="flex items-center justify-between">
                <FieldLabel>Password</FieldLabel>
                <Link
                  href="/forgot-password"
                  className="text-xs text-muted-foreground hover:text-primary hover:underline"
                >
                  Forgot password?
                </Link>
              </div>
              <FieldControl>
                <Input
                  type="password"
                  placeholder="Enter your password"
                  autoComplete="current-password"
                  disabled={isLoading}
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  onBlur={field.handleBlur}
                />
              </FieldControl>
              <FieldMessage />
            </Field>
          )}
        </form.Field>
      </div>

      <Button type="submit" className="w-full" disabled={isLoading}>
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
