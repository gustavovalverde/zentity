"use client";

import { useForm } from "@tanstack/react-form";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { PasswordRequirements } from "@/components/auth/password-requirements";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Field,
  FieldControl,
  FieldLabel,
  FieldMessage,
} from "@/components/ui/tanstack-form";
import {
  authClient,
  getBetterAuthErrorMessage,
  getPasswordLengthError,
  getPasswordPolicyErrorMessage,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from "@/lib/auth";

interface ResetPasswordFormProps {
  token: string;
}

export function ResetPasswordForm({ token }: ResetPasswordFormProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [breachCheckKey, setBreachCheckKey] = useState(0);
  const [breachStatus, setBreachStatus] = useState<
    "idle" | "checking" | "safe" | "compromised" | "error"
  >("idle");

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
          const rawMessage = getBetterAuthErrorMessage(
            result.error,
            "Failed to reset password",
          );
          const policyMessage = getPasswordPolicyErrorMessage(result.error);
          setError(policyMessage || rawMessage);
          toast.error("Reset failed", {
            description: policyMessage || rawMessage,
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

  const triggerBreachCheckIfConfirmed = () => {
    const password = form.getFieldValue("password");
    const confirmPassword = form.getFieldValue("confirmPassword");
    if (!password || password !== confirmPassword) return;
    if (getPasswordLengthError(password)) return;
    setBreachStatus("checking");
    setBreachCheckKey((k) => k + 1);
  };

  const validatePassword = (value: string) => {
    if (!value) return "Password is required";
    if (value.length < PASSWORD_MIN_LENGTH)
      return `Password must be at least ${PASSWORD_MIN_LENGTH} characters`;
    if (value.length > PASSWORD_MAX_LENGTH)
      return `Password must be at most ${PASSWORD_MAX_LENGTH} characters`;
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
      {/* Helps password managers associate the new-password fields to a username. */}
      <input
        type="text"
        name="username"
        autoComplete="username"
        className="hidden"
        tabIndex={-1}
        aria-hidden="true"
      />
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
              <PasswordRequirements
                password={field.state.value}
                breachCheckKey={breachCheckKey}
                onBreachStatusChange={(status) => setBreachStatus(status)}
              />
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
                  onBlur={() => {
                    field.handleBlur();
                    triggerBreachCheckIfConfirmed();
                  }}
                />
              </FieldControl>
              <FieldMessage />
            </Field>
          )}
        </form.Field>
      </div>

      <p className="text-xs text-muted-foreground">
        Password must be at least {PASSWORD_MIN_LENGTH} characters. We block
        passwords found in known data breaches.
      </p>

      <Button
        type="submit"
        className="w-full"
        disabled={
          isLoading ||
          breachStatus === "checking" ||
          breachStatus === "compromised"
        }
      >
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
