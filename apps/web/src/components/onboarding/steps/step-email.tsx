"use client";

import { useForm } from "@tanstack/react-form";
import { useEffect, useId, useRef } from "react";

import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { emailSchema } from "@/features/auth/schemas/sign-up.schema";
import { makeFieldValidator } from "@/lib/utils/validation";

import { WizardNavigation } from "../wizard-navigation";
import { useWizard } from "../wizard-provider";

/**
 * Step 1: Email Only
 *
 * Minimal friction start - just collect email.
 * Password will be collected at the end after verification.
 *
 * SECURITY: Always starts a fresh session to prevent session bleeding
 * where User B might see User A's previous progress.
 */
export function StepEmail() {
  const { state, updateData, nextStep, startFresh } = useWizard();
  const inputRef = useRef<HTMLInputElement>(null);
  const emailId = useId();
  const validateEmail = makeFieldValidator(
    emailSchema,
    "email",
    (value: string) => ({ email: value })
  );
  const validateEmailIfPresent = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }
    return validateEmail(trimmed);
  };

  // Focus input after mount to avoid autoFocus triggering blur during hydration
  useEffect(() => {
    // Small delay to ensure React's hydration/StrictMode cycles are complete
    const timer = setTimeout(() => {
      inputRef.current?.focus();
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  const form = useForm({
    defaultValues: {
      email: state.data.email ?? "",
    },
    onSubmit: async ({ value }) => {
      const trimmed = value.email.trim();
      // SECURITY: Always start fresh session when submitting email
      // This clears any existing session to prevent session bleeding
      await startFresh(trimmed);
      updateData({ email: trimmed });
      nextStep();
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
    form.handleSubmit();
  };

  return (
    <form className="space-y-6" onSubmit={handleSubmit}>
      <div className="space-y-2">
        <h3 className="font-medium text-lg">Get Started</h3>
        <p className="text-muted-foreground text-sm">
          Enter an email to enable account recovery, or continue anonymously.
        </p>
      </div>

      <FieldGroup>
        <form.Field
          name="email"
          validators={{
            onBlur: ({ value }) => validateEmailIfPresent(value),
            onSubmit: ({ value }) => validateEmail(value),
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
                <FieldLabel htmlFor={emailId}>Email Address</FieldLabel>
                <Input
                  aria-invalid={isInvalid}
                  autoComplete="email"
                  id={emailId}
                  name={field.name}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                  placeholder="you@example.com"
                  ref={inputRef}
                  type="email"
                  value={field.state.value}
                />
                <FieldError>{errorMessage}</FieldError>
              </Field>
            );
          }}
        </form.Field>
      </FieldGroup>

      <p className="text-muted-foreground text-xs">
        We&apos;ll use this email to contact you if needed and for account
        recovery.
      </p>

      <WizardNavigation
        onSkip={async () => {
          form.reset();
          await startFresh(null);
          updateData({ email: null });
          nextStep();
        }}
        showSkip
        skipLabel="Continue without email"
      />
    </form>
  );
}
