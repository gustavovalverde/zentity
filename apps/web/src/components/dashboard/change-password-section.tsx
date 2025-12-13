"use client";

import { useForm } from "@tanstack/react-form";
import { Key, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { PasswordRequirements } from "@/components/auth/password-requirements";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Field,
  FieldControl,
  FieldLabel,
  FieldMessage,
} from "@/components/ui/tanstack-form";
import { authClient } from "@/lib/auth-client";
import {
  getBetterAuthErrorMessage,
  getPasswordPolicyErrorMessage,
} from "@/lib/better-auth-errors";
import {
  getPasswordLengthError,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from "@/lib/password-policy";

export function ChangePasswordSection() {
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [breachCheckKey, setBreachCheckKey] = useState(0);
  const [breachStatus, setBreachStatus] = useState<
    "idle" | "checking" | "safe" | "compromised" | "error"
  >("idle");

  const form = useForm({
    defaultValues: {
      currentPassword: "",
      newPassword: "",
      confirmPassword: "",
    },
    onSubmit: async ({ value }) => {
      if (value.newPassword !== value.confirmPassword) {
        setError("New passwords do not match");
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const result = await authClient.changePassword({
          currentPassword: value.currentPassword,
          newPassword: value.newPassword,
          revokeOtherSessions: true,
        });

        if (result.error) {
          const rawMessage = getBetterAuthErrorMessage(
            result.error,
            "Failed to change password",
          );
          const policyMessage = getPasswordPolicyErrorMessage(result.error);
          setError(policyMessage || rawMessage);
          toast.error("Password change failed", {
            description: policyMessage || rawMessage,
          });
          return;
        }

        toast.success("Password changed successfully");
        form.reset();
      } catch {
        setError("An unexpected error occurred. Please try again.");
        toast.error("Password change failed");
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
    const password = form.getFieldValue("newPassword");
    const confirmPassword = form.getFieldValue("confirmPassword");
    if (!password || password !== confirmPassword) return;
    if (getPasswordLengthError(password)) return;
    setBreachStatus("checking");
    setBreachCheckKey((k) => k + 1);
  };

  const validateCurrentPassword = (value: string) => {
    if (!value) return "Current password is required";
    return undefined;
  };

  const validateNewPassword = (value: string) => {
    if (!value) return "New password is required";
    if (value.length < PASSWORD_MIN_LENGTH)
      return `Password must be at least ${PASSWORD_MIN_LENGTH} characters`;
    if (value.length > PASSWORD_MAX_LENGTH)
      return `Password must be at most ${PASSWORD_MAX_LENGTH} characters`;
    return undefined;
  };

  const validateConfirmPassword = (value: string) => {
    if (!value) return "Please confirm your new password";
    if (value !== form.getFieldValue("newPassword"))
      return "Passwords do not match";
    return undefined;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Key className="h-5 w-5" />
          Change Password
        </CardTitle>
        <CardDescription>
          Update your password to keep your account secure
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
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

          <form.Field
            name="currentPassword"
            validators={{
              onBlur: ({ value }) => validateCurrentPassword(value),
              onSubmit: ({ value }) => validateCurrentPassword(value),
            }}
          >
            {(field) => (
              <Field
                name={field.name}
                errors={field.state.meta.errors as string[]}
                isTouched={field.state.meta.isTouched}
                isValidating={field.state.meta.isValidating}
              >
                <FieldLabel>Current Password</FieldLabel>
                <FieldControl>
                  <Input
                    type="password"
                    placeholder="Enter current password"
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

          <form.Field
            name="newPassword"
            validators={{
              onBlur: ({ value }) => validateNewPassword(value),
              onSubmit: ({ value }) => validateNewPassword(value),
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
                <FieldLabel>Confirm New Password</FieldLabel>
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

          <Button
            type="submit"
            disabled={
              isLoading ||
              breachStatus === "checking" ||
              breachStatus === "compromised"
            }
          >
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Changing...
              </>
            ) : (
              "Change Password"
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
