"use client";

import { useForm } from "@tanstack/react-form";
import { useId, useState } from "react";

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
  getPasswordLengthError,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from "@/lib/auth/password-policy";

interface PasswordSignUpFormProps {
  email: string;
  userId?: string;
  isAnonymous?: boolean;
  onSuccess: (result: {
    userId: string;
    email: string;
    exportKey: Uint8Array;
  }) => void;
  onBack?: () => void;
  disabled?: boolean;
}

/**
 * Password sign-up form for sign-up.
 * Uses OPAQUE protocol to register a new user with email and password.
 * For anonymous users, adds password to existing account via setPassword.
 * For new users, creates account via signUp.opaque.
 * Returns the export key for FHE key wrapping.
 */
export function PasswordSignUpForm({
  email,
  userId,
  isAnonymous = false,
  onSuccess,
  onBack,
  disabled = false,
}: Readonly<PasswordSignUpFormProps>) {
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
        if (isAnonymous && userId) {
          // Anonymous user: add password to existing account
          const result = await authClient.opaque.setPassword({
            password: value.password,
          });

          if (!result.data || result.error) {
            const message =
              result.error?.message ||
              "Failed to set password. Please try again.";
            setError(message);
            return;
          }

          onSuccess({
            userId,
            email,
            exportKey: result.data.exportKey,
          });
        } else {
          // New user: create account with email and password
          const result = await authClient.signUp.opaque({
            email,
            password: value.password,
          });

          if (!result.data || result.error) {
            const message =
              result.error?.message ||
              "Failed to create account. Please try again.";
            setError(message);
            return;
          }

          onSuccess({
            userId: result.data.user.id,
            email: result.data.user.email,
            exportKey: result.data.exportKey,
          });
        }
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "An unexpected error occurred";
        setError(message);
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

  const isSubmitDisabled =
    disabled ||
    isLoading ||
    breachStatus === "checking" ||
    breachStatus === "compromised";

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="font-semibold text-lg">Create Your Password</h2>
        <p className="mt-1 text-muted-foreground text-sm">
          Choose a secure password for your account
        </p>
      </div>

      <form className="space-y-4" onSubmit={handleSubmit}>
        {/* Hidden username for password managers */}
        <input
          aria-hidden="true"
          autoComplete="username"
          className="hidden"
          defaultValue={email}
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
                  <FieldLabel htmlFor={passwordId}>Password</FieldLabel>
                  <InputGroup>
                    <InputGroupInput
                      aria-invalid={isInvalid}
                      autoComplete="new-password"
                      disabled={isLoading || disabled}
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
                      disabled={isLoading || disabled}
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

        <div className="flex gap-3">
          {onBack ? (
            <Button
              disabled={isLoading}
              onClick={onBack}
              type="button"
              variant="outline"
            >
              Back
            </Button>
          ) : null}
          <Button className="flex-1" disabled={isSubmitDisabled} type="submit">
            {isLoading ? <Spinner aria-hidden="true" className="mr-2" /> : null}
            Create Account
          </Button>
        </div>
      </form>
    </div>
  );
}
