"use client";

import { useForm } from "@tanstack/react-form";
import { useWizard } from "../wizard-provider";
import { WizardNavigation } from "../wizard-navigation";
import { emailSchema } from "@/features/auth/schemas/sign-up.schema";
import {
  Field,
  FieldControl,
  FieldLabel,
  FieldMessage,
} from "@/components/ui/tanstack-form";
import { Input } from "@/components/ui/input";

/**
 * Step 1: Email Only
 *
 * Minimal friction start - just collect email.
 * Password will be collected at the end after verification.
 */
export function StepEmail() {
  const { state, updateData, nextStep } = useWizard();

  const form = useForm({
    defaultValues: {
      email: state.data.email || "",
    },
    onSubmit: async ({ value }) => {
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
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="space-y-2">
        <h3 className="text-lg font-medium">Get Started</h3>
        <p className="text-sm text-muted-foreground">
          Enter your email to begin identity verification.
        </p>
      </div>

      <form.Field
        name="email"
        validators={{
          onBlur: ({ value }) => {
            const result = emailSchema.safeParse({ email: value });
            if (!result.success) {
              return result.error.issues[0]?.message || "Invalid email";
            }
            return undefined;
          },
          onSubmit: ({ value }) => {
            const result = emailSchema.safeParse({ email: value });
            if (!result.success) {
              return result.error.issues[0]?.message || "Invalid email";
            }
            return undefined;
          },
        }}
      >
        {(field) => (
          <Field
            name={field.name}
            errors={field.state.meta.errors as string[]}
            isTouched={field.state.meta.isTouched}
            isValidating={field.state.meta.isValidating}
          >
            <FieldLabel>Email Address</FieldLabel>
            <FieldControl>
              <Input
                type="email"
                placeholder="you@example.com"
                autoComplete="email"
                autoFocus
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
        We'll use this email to contact you if needed and for account recovery.
      </p>

      <WizardNavigation />
    </form>
  );
}
