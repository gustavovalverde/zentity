"use client";

import { validateEmailAddress } from "@better-auth-ui/core";
import { magicLinkPlugin } from "@better-auth-ui/core/plugins/magic-link";
import { useAuth, useAuthPlugin } from "@better-auth-ui/react";
import { useSignInMagicLink } from "@better-auth-ui/react/plugins/magic-link";
import { useForm } from "@tanstack/react-form";
import { useId } from "react";

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
import { reportRejection } from "@/lib/async-handler";
import { authClient } from "@/lib/auth/auth-client";
import { getSafeRedirectPath } from "@/lib/auth/redirect";
import { prepareForNewSession } from "@/lib/auth/session-cleanup";

const validateEmail = (value: string) =>
  validateEmailAddress(value, {
    invalidMessage: "Enter a valid email address",
    requiredMessage: "Email is required",
  });

export function MagicLinkForm() {
  const emailId = useId();
  const { basePaths, navigate, redirectTo } = useAuth();
  const { viewPaths } = useAuthPlugin(magicLinkPlugin);
  const signInMagicLink = useSignInMagicLink(authClient);

  const form = useForm({
    defaultValues: { email: "" },
    onSubmit: ({ value }) => {
      const email = value.email.trim();
      prepareForNewSession();
      signInMagicLink.mutate(
        {
          email,
          callbackURL: getSafeRedirectPath(redirectTo, "/dashboard"),
        },
        {
          onSuccess: () =>
            navigate({
              to: `${basePaths.auth}/${viewPaths.auth.magicLinkSent}?email=${encodeURIComponent(email)}`,
            }),
        }
      );
    },
  });

  const handleSubmit: React.SubmitEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    event.stopPropagation();
    form.handleSubmit().catch(reportRejection);
  };

  const isPending = signInMagicLink.isPending;

  return (
    <form className="space-y-6" noValidate onSubmit={handleSubmit}>
      {signInMagicLink.isError ? (
        <Alert variant="destructive">
          <AlertDescription>
            We couldn't send the link. Check your connection and try again.
          </AlertDescription>
        </Alert>
      ) : null}

      <FieldGroup>
        <form.Field
          name="email"
          validators={{
            onBlur: ({ value }) => validateEmail(value),
            onSubmit: ({ value }) => validateEmail(value),
          }}
        >
          {(field) => {
            const isInvalid =
              field.state.meta.isTouched && !field.state.meta.isValid;
            return (
              <Field data-invalid={isInvalid}>
                <FieldLabel htmlFor={emailId}>Email</FieldLabel>
                <Input
                  aria-invalid={isInvalid}
                  autoCapitalize="none"
                  autoComplete="email"
                  disabled={isPending}
                  id={emailId}
                  name={field.name}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  placeholder="you@example.com"
                  spellCheck={false}
                  type="email"
                  value={field.state.value}
                />
                {isInvalid ? (
                  <FieldError errors={field.state.meta.errors} />
                ) : null}
              </Field>
            );
          }}
        </form.Field>
      </FieldGroup>

      <Button className="w-full" disabled={isPending} type="submit">
        {isPending ? <Spinner aria-hidden="true" className="mr-2" /> : null}
        Send Magic Link
      </Button>
    </form>
  );
}
