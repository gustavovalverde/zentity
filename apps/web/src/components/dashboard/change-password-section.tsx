"use client";

import { useForm } from "@tanstack/react-form";
import { Key, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
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

export function ChangePasswordSection() {
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

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
          setError(result.error.message || "Failed to change password");
          toast.error("Password change failed", {
            description: result.error.message,
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

  const validateCurrentPassword = (value: string) => {
    if (!value) return "Current password is required";
    return undefined;
  };

  const validateNewPassword = (value: string) => {
    if (!value) return "New password is required";
    if (value.length < 8) return "Password must be at least 8 characters";
    if (!/[A-Z]/.test(value))
      return "Password must contain an uppercase letter";
    if (!/[a-z]/.test(value)) return "Password must contain a lowercase letter";
    if (!/[0-9]/.test(value)) return "Password must contain a number";
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
                    onBlur={field.handleBlur}
                  />
                </FieldControl>
                <FieldMessage />
              </Field>
            )}
          </form.Field>

          <p className="text-xs text-muted-foreground">
            Password must be at least 8 characters with uppercase, lowercase,
            and a number.
          </p>

          <Button type="submit" disabled={isLoading}>
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
