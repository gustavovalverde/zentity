"use client";

import { useForm } from "@tanstack/react-form";
import { useEffect, useRef } from "react";

import { Input } from "@/components/ui/input";
import {
  Field,
  FieldControl,
  FieldLabel,
  FieldMessage,
} from "@/components/ui/tanstack-form";
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
  const validateEmail = makeFieldValidator(
    emailSchema,
    "email",
    (value: string) => ({ email: value })
  );

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
      email: state.data.email || "",
    },
    onSubmit: async ({ value }) => {
      // SECURITY: Always start fresh session when submitting email
      // This clears any existing session to prevent session bleeding
      await startFresh(value.email);
      updateData(value);
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
          Enter your email to begin identity verification.
        </p>
      </div>

      <form.Field
        name="email"
        validators={{
          onBlur: ({ value }) => validateEmail(value),
          onSubmit: ({ value }) => validateEmail(value),
        }}
      >
        {(field) => (
          <Field
            errors={field.state.meta.errors as string[]}
            isTouched={field.state.meta.isTouched}
            isValidating={field.state.meta.isValidating}
            name={field.name}
          >
            <FieldLabel>Email Address</FieldLabel>
            <FieldControl>
              <Input
                autoComplete="email"
                onBlur={field.handleBlur}
                onChange={(e) => field.handleChange(e.target.value)}
                placeholder="you@example.com"
                ref={inputRef}
                type="email"
                value={field.state.value}
              />
            </FieldControl>
            <FieldMessage />
          </Field>
        )}
      </form.Field>

      <p className="text-muted-foreground text-xs">
        We&apos;ll use this email to contact you if needed and for account
        recovery.
      </p>

      <WizardNavigation />
    </form>
  );
}
