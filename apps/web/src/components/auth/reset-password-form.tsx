"use client";

import { useForm } from "@tanstack/react-form";
import { Loader2 } from "lucide-react";
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
import { authClient } from "@/lib/auth-client";

interface ResetPasswordFormProps {
  token: string;
}

export function ResetPasswordForm({ token }: ResetPasswordFormProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const form = useForm({
    defaultValues: {
      password: "",
      confirmPassword: "",
    },
    onSubmit: async ({ value }) => {
      if (value.password !== value.confirmPassword) {
        setError("Passwords do not match");
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const result = await authClient.resetPassword({
          newPassword: value.password,
          token,
        });

        if (result.error) {
          setError(result.error.message || "Failed to reset password");
          toast.error("Reset failed", {
            description: result.error.message,
          });
          return;
        }

        toast.success("Password reset successfully!", {
          description: "You can now sign in with your new password.",
        });
        router.push("/sign-in");
      } catch {
        setError("An unexpected error occurred. Please try again.");
        toast.error("Reset failed");
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

  const validatePassword = (value: string) => {
    if (!value) return "Password is required";
    if (value.length < 8) return "Password must be at least 8 characters";
    if (!/[A-Z]/.test(value))
      return "Password must contain an uppercase letter";
    if (!/[a-z]/.test(value)) return "Password must contain a lowercase letter";
    if (!/[0-9]/.test(value)) return "Password must contain a number";
    return undefined;
  };

  const validateConfirmPassword = (value: string) => {
    if (!value) return "Please confirm your password";
    if (value !== form.getFieldValue("password"))
      return "Passwords do not match";
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
          name="password"
          validators={{
            onBlur: ({ value }) => validatePassword(value),
            onSubmit: ({ value }) => validatePassword(value),
          }}
        >
          {(field) => (
            <Field
              name={field.name}
              errors={field.state.meta.errors as string[]}
              isTouched={field.state.meta.isTouched}
              isValidating={field.state.meta.isValidating}
            >
              <FieldLabel>New Password</FieldLabel>
              <FieldControl>
                <Input
                  type="password"
                  placeholder="Enter new password"
                  autoComplete="new-password"
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
          name="confirmPassword"
          validators={{
            onBlur: ({ value }) => validateConfirmPassword(value),
            onSubmit: ({ value }) => validateConfirmPassword(value),
          }}
        >
          {(field) => (
            <Field
              name={field.name}
              errors={field.state.meta.errors as string[]}
              isTouched={field.state.meta.isTouched}
              isValidating={field.state.meta.isValidating}
            >
              <FieldLabel>Confirm Password</FieldLabel>
              <FieldControl>
                <Input
                  type="password"
                  placeholder="Confirm new password"
                  autoComplete="new-password"
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

      <p className="text-xs text-muted-foreground">
        Password must be at least 8 characters with uppercase, lowercase, and a
        number.
      </p>

      <Button type="submit" className="w-full" disabled={isLoading}>
        {isLoading ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Resetting...
          </>
        ) : (
          "Reset Password"
        )}
      </Button>
    </form>
  );
}
