"use client";

import { useForm } from "@tanstack/react-form";
import { KeyRound } from "lucide-react";
import { useId, useState } from "react";
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
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { InputGroup, InputGroupInput } from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";
import { authClient, useSession } from "@/lib/auth/auth-client";
import {
  getPasswordLengthError,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from "@/lib/auth/password-policy";
import { FHE_SECRET_TYPE } from "@/lib/crypto/fhe-key-store";
import { PROFILE_SECRET_TYPE } from "@/lib/crypto/profile-secret";
import {
  cacheOpaqueExportKey,
  updateOpaqueWrapperForSecretType,
} from "@/lib/crypto/secret-vault";

interface OpaqueChangePasswordSectionProps {
  onPasswordChanged?: () => void;
}

export function OpaqueChangePasswordSection({
  onPasswordChanged,
}: Readonly<OpaqueChangePasswordSectionProps>) {
  const currentPasswordId = useId();
  const newPasswordId = useId();
  const confirmPasswordId = useId();
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [breachCheckKey, setBreachCheckKey] = useState(0);
  const [breachStatus, setBreachStatus] = useState<
    "idle" | "checking" | "safe" | "compromised" | "error"
  >("idle");
  const { data: sessionData } = useSession();

  const form = useForm({
    defaultValues: {
      currentPassword: "",
      newPassword: "",
      confirmPassword: "",
    },
    onSubmit: async ({ value }) => {
      if (value.newPassword !== value.confirmPassword) {
        setError("Passwords do not match");
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const result = await authClient.opaque.changePassword({
          currentPassword: value.currentPassword,
          newPassword: value.newPassword,
        });

        if (!result.data || result.error) {
          const message =
            result.error?.message ||
            "Failed to update password. Please try again.";
          setError(message);
          toast.error("Password update failed", { description: message });
          return;
        }

        // Re-wrap secrets with new export key and update cache
        const userId = sessionData?.user?.id;
        if (userId && result.data.oldExportKey && result.data.exportKey) {
          try {
            await Promise.all([
              updateOpaqueWrapperForSecretType({
                secretType: FHE_SECRET_TYPE,
                userId,
                oldExportKey: result.data.oldExportKey,
                newExportKey: result.data.exportKey,
              }),
              updateOpaqueWrapperForSecretType({
                secretType: PROFILE_SECRET_TYPE,
                userId,
                oldExportKey: result.data.oldExportKey,
                newExportKey: result.data.exportKey,
              }),
            ]);
            // Update the cached export key for secret retrieval
            cacheOpaqueExportKey({
              userId,
              exportKey: result.data.exportKey,
            });
          } catch {
            // Keep the cached key aligned with existing wrappers on failure.
            cacheOpaqueExportKey({
              userId,
              exportKey: result.data.oldExportKey,
            });
            toast.message(
              "Password changed, but some encrypted data may need re-setup",
              {
                description:
                  "Your FHE keys or profile data may need to be re-enrolled.",
              }
            );
          }
        }

        toast.success("Password updated", {
          description: "Your password has been changed successfully.",
        });
        onPasswordChanged?.();
        form.reset();
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "An unexpected error occurred";
        setError(message);
        toast.error("Password update failed", { description: message });
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
    setBreachCheckKey((key) => key + 1);
  };

  const validateCurrentPassword = (value: string) => {
    if (!value) {
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
          <KeyRound className="h-5 w-5" />
          Change Password
        </CardTitle>
        <CardDescription>
          Update your password for secure, zero-knowledge sign-in.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={handleSubmit}>
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <FieldGroup>
            <form.Field
              name="currentPassword"
              validators={{
                onBlur: ({ value }) => validateCurrentPassword(value),
                onSubmit: ({ value }) => validateCurrentPassword(value),
              }}
            >
              {(field) => {
                const isInvalid =
                  field.state.meta.isTouched && !field.state.meta.isValid;
                const errorMessage = isInvalid
                  ? (field.state.meta.errors?.[0] as string | undefined)
                  : undefined;
                return (
                  <Field data-invalid={isInvalid}>
                    <FieldLabel htmlFor={currentPasswordId}>
                      Current Password
                    </FieldLabel>
                    <InputGroup>
                      <InputGroupInput
                        aria-invalid={isInvalid}
                        autoComplete="current-password"
                        disabled={isLoading}
                        id={currentPasswordId}
                        name={field.name}
                        onBlur={field.handleBlur}
                        onChange={(e) => field.handleChange(e.target.value)}
                        placeholder="Enter current password"
                        type="password"
                        value={field.state.value}
                      />
                    </InputGroup>
                    <FieldError>{errorMessage}</FieldError>
                  </Field>
                );
              }}
            </form.Field>

            <form.Field
              name="newPassword"
              validators={{
                onBlur: ({ value }) => validateNewPassword(value),
                onSubmit: ({ value }) => validateNewPassword(value),
              }}
            >
              {(field) => {
                const isInvalid =
                  field.state.meta.isTouched && !field.state.meta.isValid;
                const errorMessage = isInvalid
                  ? (field.state.meta.errors?.[0] as string | undefined)
                  : undefined;
                return (
                  <Field data-invalid={isInvalid}>
                    <FieldLabel htmlFor={newPasswordId}>
                      New Password
                    </FieldLabel>
                    <InputGroup>
                      <InputGroupInput
                        aria-invalid={isInvalid}
                        autoComplete="new-password"
                        disabled={isLoading}
                        id={newPasswordId}
                        name={field.name}
                        onBlur={field.handleBlur}
                        onChange={(e) => field.handleChange(e.target.value)}
                        placeholder="Enter new password"
                        type="password"
                        value={field.state.value}
                      />
                    </InputGroup>
                    <FieldError>{errorMessage}</FieldError>
                    <PasswordRequirements
                      breachCheckKey={breachCheckKey}
                      onBreachStatusChange={(status) => setBreachStatus(status)}
                      password={field.state.value}
                    />
                  </Field>
                );
              }}
            </form.Field>

            <form.Field
              name="confirmPassword"
              validators={{
                onBlur: ({ value }) => validateConfirmPassword(value),
                onSubmit: ({ value }) => validateConfirmPassword(value),
              }}
            >
              {(field) => {
                const isInvalid =
                  field.state.meta.isTouched && !field.state.meta.isValid;
                const errorMessage = isInvalid
                  ? (field.state.meta.errors?.[0] as string | undefined)
                  : undefined;
                return (
                  <Field data-invalid={isInvalid}>
                    <FieldLabel htmlFor={confirmPasswordId}>
                      Confirm New Password
                    </FieldLabel>
                    <InputGroup>
                      <InputGroupInput
                        aria-invalid={isInvalid}
                        autoComplete="new-password"
                        disabled={isLoading}
                        id={confirmPasswordId}
                        name={field.name}
                        onBlur={() => {
                          field.handleBlur();
                          triggerBreachCheckIfConfirmed();
                        }}
                        onChange={(e) => field.handleChange(e.target.value)}
                        placeholder="Confirm new password"
                        type="password"
                        value={field.state.value}
                      />
                    </InputGroup>
                    <FieldError>{errorMessage}</FieldError>
                  </Field>
                );
              }}
            </form.Field>
          </FieldGroup>

          <Button
            disabled={
              isLoading ||
              breachStatus === "checking" ||
              breachStatus === "compromised"
            }
            type="submit"
          >
            {isLoading ? <Spinner aria-hidden="true" className="mr-2" /> : null}
            Update Password
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
