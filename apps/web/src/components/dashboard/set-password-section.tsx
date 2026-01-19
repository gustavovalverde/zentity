"use client";

import { useForm } from "@tanstack/react-form";
import { Plus } from "lucide-react";
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
import { SECRET_TYPES } from "@/lib/privacy/crypto/secret-types";
import { addOpaqueWrapperForSecretType } from "@/lib/privacy/crypto/secret-vault";

interface SetPasswordSectionProps {
  onPasswordSet?: () => void;
}

/**
 * Component for passwordless users to set an initial password.
 * This enables password sign-in as an alternative to passkeys.
 */
export function SetPasswordSection({
  onPasswordSet,
}: Readonly<SetPasswordSectionProps>) {
  const passwordId = useId();
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
        const result = await authClient.opaque.setPassword({
          password: value.newPassword,
        });

        if (!result.data || result.error) {
          const message =
            result.error?.message ||
            "Failed to set password. Please try again.";
          setError(message);
          toast.error("Failed to set password", { description: message });
          return;
        }

        const userId = sessionData?.user?.id;
        if (userId) {
          try {
            await Promise.all([
              addOpaqueWrapperForSecretType({
                secretType: SECRET_TYPES.FHE_KEYS,
                userId,
                exportKey: result.data.exportKey,
              }),
              addOpaqueWrapperForSecretType({
                secretType: SECRET_TYPES.PROFILE,
                userId,
                exportKey: result.data.exportKey,
              }),
            ]);
          } catch {
            toast.message(
              "Password set, but secret wrappers could not be prepared yet."
            );
          }
        } else {
          toast.message(
            "Password set, but secret wrappers could not be prepared yet."
          );
        }

        toast.success("Password set successfully", {
          description: "You can now sign in with your password.",
        });
        onPasswordSet?.();
        form.reset();
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "An unexpected error occurred";
        setError(message);
        toast.error("Failed to set password", { description: message });
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

  const validateNewPassword = (value: string) => {
    if (!value) {
      return "Password is required";
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
      return "Please confirm your password";
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
          <Plus className="h-5 w-5" />
          Set Password
        </CardTitle>
        <CardDescription>
          Add a password to enable password sign-in as an alternative to
          passkeys
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={handleSubmit}>
          {/* Hidden username for password managers */}
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

          <FieldGroup>
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
                    <FieldLabel htmlFor={passwordId}>Password</FieldLabel>
                    <InputGroup>
                      <InputGroupInput
                        aria-invalid={isInvalid}
                        autoComplete="new-password"
                        disabled={isLoading}
                        id={passwordId}
                        name={field.name}
                        onBlur={field.handleBlur}
                        onChange={(e) => field.handleChange(e.target.value)}
                        placeholder="Enter password"
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
                      Confirm Password
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
                        placeholder="Confirm password"
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
            Set Password
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
