"use client";

import { useForm } from "@tanstack/react-form";
import { KeyRound } from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { authClient } from "@/lib/auth/auth-client";
import { prepareForNewSession } from "@/lib/auth/session-manager";
import { cacheOpaqueExportKey } from "@/lib/crypto/secret-vault";
import { redirectTo } from "@/lib/utils/navigation";

export function OpaqueSignInForm() {
  const identifierId = useId();
  const passwordId = useId();
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const form = useForm({
    defaultValues: {
      identifier: "",
      password: "",
    },
    onSubmit: async ({ value }) => {
      setIsLoading(true);
      setError(null);
      prepareForNewSession();

      try {
        const result = await authClient.signIn.opaque({
          identifier: value.identifier,
          password: value.password,
        });

        if (!result.data || result.error) {
          const message =
            result.error?.message || "Invalid credentials. Please try again.";
          setError(message);
          toast.error("Sign in failed", { description: message });
          return;
        }

        // Cache the OPAQUE export key for secret retrieval
        // This enables password-only users to access their encrypted secrets
        if (result.data.exportKey && result.data.user?.id) {
          cacheOpaqueExportKey({
            userId: result.data.user.id,
            exportKey: result.data.exportKey,
          });
        }

        toast.success("Signed in successfully!");
        redirectTo("/dashboard");
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : "Sign in failed. Please try again.";
        setError(message);
        toast.error("Sign in failed", { description: message });
      } finally {
        setIsLoading(false);
      }
    },
  });

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    event.stopPropagation();
    form.handleSubmit();
  };

  const validateIdentifier = (value: string) => {
    if (!value.trim()) {
      return "Email or recovery ID is required";
    }
    return;
  };

  const validatePassword = (value: string) => {
    if (!value) {
      return "Password is required";
    }
    return;
  };

  return (
    <form className="space-y-6" onSubmit={handleSubmit}>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <FieldGroup>
        <form.Field
          name="identifier"
          validators={{
            onBlur: ({ value }) => validateIdentifier(value),
            onSubmit: ({ value }) => validateIdentifier(value),
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
                <FieldLabel htmlFor={identifierId}>
                  Email or Recovery ID
                </FieldLabel>
                <Input
                  aria-invalid={isInvalid}
                  autoCapitalize="none"
                  autoComplete="username"
                  disabled={isLoading}
                  id={identifierId}
                  name={field.name}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                  placeholder="you@example.com or rec_abc123..."
                  spellCheck={false}
                  value={field.state.value}
                />
                <FieldError>{errorMessage}</FieldError>
              </Field>
            );
          }}
        </form.Field>

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
                <Input
                  aria-invalid={isInvalid}
                  autoComplete="current-password"
                  disabled={isLoading}
                  id={passwordId}
                  name={field.name}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                  placeholder="Enter password"
                  type="password"
                  value={field.state.value}
                />
                <FieldError>{errorMessage}</FieldError>
              </Field>
            );
          }}
        </form.Field>
      </FieldGroup>

      <div className="flex items-center justify-between text-muted-foreground text-xs">
        <span>OPAQUE password sign-in (zero-knowledge).</span>
        <Link
          className="font-medium text-primary hover:underline"
          href="/forgot-password"
        >
          Forgot password?
        </Link>
      </div>

      <Button className="w-full" disabled={isLoading} type="submit">
        {isLoading ? <Spinner aria-hidden="true" className="mr-2" /> : null}
        <KeyRound className="mr-2 h-4 w-4" />
        Sign in with Password
      </Button>
    </form>
  );
}
