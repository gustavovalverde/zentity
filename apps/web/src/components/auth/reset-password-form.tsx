"use client";

import { useForm } from "@tanstack/react-form";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { toast } from "sonner";

import { PasswordRequirements } from "@/components/auth/password-requirements";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { InputGroup, InputGroupInput } from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";
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

interface ResetPasswordFormProps {
  token: string;
}

export function ResetPasswordForm({ token }: ResetPasswordFormProps) {
  const router = useRouter();
  const passwordId = useId();
  const confirmPasswordId = useId();
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
            "Failed to reset password"
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
    if (!password || password !== confirmPassword) {
      return;
    }
    if (getPasswordLengthError(password)) {
      return;
    }
    setBreachStatus("checking");
    setBreachCheckKey((k) => k + 1);
  };

  const validatePassword = (value: string) => {
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
    if (value !== form.getFieldValue("password")) {
      return "Passwords do not match";
    }
    return;
  };

  return (
    <form className="space-y-6" onSubmit={handleSubmit}>
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

      <FieldGroup>
        <form.Field
          name="password"
          validators={{
            onBlur: ({ value }) => validatePassword(value),
            onSubmit: ({ value }) => validatePassword(value),
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
                <FieldLabel htmlFor={passwordId}>New Password</FieldLabel>
                <InputGroup>
                  <InputGroupInput
                    aria-invalid={isInvalid}
                    autoComplete="new-password"
                    disabled={isLoading}
                    id={passwordId}
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

      <p className="text-muted-foreground text-xs">
        Password must be at least {PASSWORD_MIN_LENGTH} characters. We block
        passwords found in known data breaches.
      </p>

      <Button
        className="w-full"
        disabled={
          isLoading ||
          breachStatus === "checking" ||
          breachStatus === "compromised"
        }
        type="submit"
      >
        {isLoading ? <Spinner aria-hidden="true" className="mr-2" /> : null}
        Reset Password
      </Button>
    </form>
  );
}
