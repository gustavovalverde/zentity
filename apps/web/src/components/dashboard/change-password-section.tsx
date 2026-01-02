"use client";

import { useForm } from "@tanstack/react-form";
import { Key, Loader2, Plus } from "lucide-react";
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
import { authClient } from "@/lib/auth/auth-client";
import {
  getBetterAuthErrorMessage,
  getPasswordPolicyErrorMessage,
} from "@/lib/auth/better-auth-errors";
import {
  getPasswordLengthError,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from "@/lib/auth/password-policy";
import { trpc } from "@/lib/trpc/client";

interface ChangePasswordSectionProps {
  hasPassword: boolean;
  onPasswordSet?: () => void;
}

export function ChangePasswordSection({
  hasPassword,
  onPasswordSet,
}: ChangePasswordSectionProps) {
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
        if (hasPassword) {
          // Change existing password
          const result = await authClient.changePassword({
            currentPassword: value.currentPassword,
            newPassword: value.newPassword,
            revokeOtherSessions: true,
          });

          if (result.error) {
            const rawMessage = getBetterAuthErrorMessage(
              result.error,
              "Failed to change password"
            );
            const policyMessage = getPasswordPolicyErrorMessage(result.error);
            setError(policyMessage || rawMessage);
            toast.error("Password change failed", {
              description: policyMessage || rawMessage,
            });
            return;
          }

          toast.success("Password changed successfully");
        } else {
          // Set new password for passwordless user
          await trpc.account.setPassword.mutate({
            newPassword: value.newPassword,
          });

          toast.success("Password set successfully", {
            description: "You can now sign in with your email and password.",
          });
          onPasswordSet?.();
        }

        form.reset();
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "An unexpected error occurred";
        setError(message);
        toast.error(
          hasPassword ? "Password change failed" : "Failed to set password",
          {
            description: message,
          }
        );
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
    if (!password || password !== confirmPassword) {
      return;
    }
    if (getPasswordLengthError(password)) {
      return;
    }
    setBreachStatus("checking");
    setBreachCheckKey((k) => k + 1);
  };

  const validateCurrentPassword = (value: string) => {
    // Only required when changing an existing password
    if (hasPassword && !value) {
      return "Current password is required";
    }
    return;
  };

  const validateNewPassword = (value: string) => {
    if (!value) {
      return "New password is required";
    }
    if (value.length < PASSWORD_MIN_LENGTH) {
      return `Password must be at least ${PASSWORD_MIN_LENGTH} characters`;
    }
    if (value.length > PASSWORD_MAX_LENGTH) {
      return `Password must be at most ${PASSWORD_MAX_LENGTH} characters`;
    }
    return;
  };

  const validateConfirmPassword = (value: string) => {
    if (!value) {
      return "Please confirm your new password";
    }
    if (value !== form.getFieldValue("newPassword")) {
      return "Passwords do not match";
    }
    return;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {hasPassword ? (
            <Key className="h-5 w-5" />
          ) : (
            <Plus className="h-5 w-5" />
          )}
          {hasPassword ? "Change Password" : "Set Password"}
        </CardTitle>
        <CardDescription>
          {hasPassword
            ? "Update your password to keep your account secure"
            : "Add a password to enable email/password sign-in as an alternative to passkeys"}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={handleSubmit}>
          {/* Helps password managers associate the new-password fields to a username. */}
          <input
            aria-hidden="true"
            autoComplete="username"
            className="hidden"
            name="username"
            tabIndex={-1}
            type="text"
          />
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          {hasPassword ? (
            <form.Field
              name="currentPassword"
              validators={{
                onBlur: ({ value }) => validateCurrentPassword(value),
                onSubmit: ({ value }) => validateCurrentPassword(value),
              }}
            >
              {(field) => (
                <Field
                  errors={field.state.meta.errors as string[]}
                  isTouched={field.state.meta.isTouched}
                  isValidating={field.state.meta.isValidating}
                  name={field.name}
                >
                  <FieldLabel>Current Password</FieldLabel>
                  <FieldControl>
                    <Input
                      autoComplete="current-password"
                      disabled={isLoading}
                      onBlur={field.handleBlur}
                      onChange={(e) => field.handleChange(e.target.value)}
                      placeholder="Enter current password"
                      type="password"
                      value={field.state.value}
                    />
                  </FieldControl>
                  <FieldMessage />
                </Field>
              )}
            </form.Field>
          ) : null}

          <form.Field
            name="newPassword"
            validators={{
              onBlur: ({ value }) => validateNewPassword(value),
              onSubmit: ({ value }) => validateNewPassword(value),
            }}
          >
            {(field) => (
              <Field
                errors={field.state.meta.errors as string[]}
                isTouched={field.state.meta.isTouched}
                isValidating={field.state.meta.isValidating}
                name={field.name}
              >
                <FieldLabel>
                  {hasPassword ? "New Password" : "Password"}
                </FieldLabel>
                <FieldControl>
                  <Input
                    autoComplete="new-password"
                    disabled={isLoading}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                    placeholder={
                      hasPassword ? "Enter new password" : "Enter password"
                    }
                    type="password"
                    value={field.state.value}
                  />
                </FieldControl>
                <FieldMessage />
                <PasswordRequirements
                  breachCheckKey={breachCheckKey}
                  onBreachStatusChange={(status) => setBreachStatus(status)}
                  password={field.state.value}
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
                errors={field.state.meta.errors as string[]}
                isTouched={field.state.meta.isTouched}
                isValidating={field.state.meta.isValidating}
                name={field.name}
              >
                <FieldLabel>
                  {hasPassword ? "Confirm New Password" : "Confirm Password"}
                </FieldLabel>
                <FieldControl>
                  <Input
                    autoComplete="new-password"
                    disabled={isLoading}
                    onBlur={() => {
                      field.handleBlur();
                      triggerBreachCheckIfConfirmed();
                    }}
                    onChange={(e) => field.handleChange(e.target.value)}
                    placeholder={
                      hasPassword ? "Confirm new password" : "Confirm password"
                    }
                    type="password"
                    value={field.state.value}
                  />
                </FieldControl>
                <FieldMessage />
              </Field>
            )}
          </form.Field>

          <Button
            disabled={
              isLoading ||
              breachStatus === "checking" ||
              breachStatus === "compromised"
            }
            type="submit"
          >
            {(() => {
              if (isLoading) {
                return (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {hasPassword ? "Changing..." : "Setting..."}
                  </>
                );
              }
              return hasPassword ? "Change Password" : "Set Password";
            })()}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
