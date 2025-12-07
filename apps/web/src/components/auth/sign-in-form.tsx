"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "@tanstack/react-form";
import { signIn } from "@/lib/auth-client";
import { signInSchema } from "@/features/auth/schemas/sign-in.schema";
import {
  Field,
  FieldControl,
  FieldLabel,
  FieldMessage,
} from "@/components/ui/tanstack-form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

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
    const result = signInSchema.safeParse({
      email: fieldName === "email" ? value : form.getFieldValue("email"),
      password: fieldName === "password" ? value : form.getFieldValue("password"),
    });
    if (!result.success) {
      const fieldError = result.error.issues.find((issue) =>
        issue.path.includes(fieldName)
      );
      return fieldError?.message;
    }
    return undefined;
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
              <FieldLabel>Password</FieldLabel>
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
