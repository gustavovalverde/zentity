"use client";

import type { ZodType } from "zod";

import { useForm } from "@tanstack/react-form";
import Link from "next/link";
import { useCallback, useEffect, useId, useState } from "react";
import { toast } from "sonner";

import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { prepareForNewSession } from "@/lib/auth/session-manager";
import { emailSchema } from "@/lib/auth/sign-up.schema";
import { setFlowId } from "@/lib/observability/flow-client";
import { trpc } from "@/lib/trpc/client";
import { useSignUpStore } from "@/store/sign-up";

function makeFieldValidator<T, V>(
  schema: ZodType<T>,
  path: string,
  build: (value: V) => unknown
) {
  return (value: V) => {
    const result = schema.safeParse(build(value));
    if (result.success) {
      return;
    }
    const issue = result.error.issues.find((i) => i.path.includes(path));
    return issue?.message;
  };
}

import { useStepper } from "./stepper-config";
import { StepperControls } from "./stepper-ui";

/**
 * Step 1: Email Only
 *
 * Minimal friction start - just collect email.
 * Passkey/password setup happens in the next step.
 *
 * SECURITY: Always starts a fresh session to prevent session bleeding
 * where User B might see User A's previous progress.
 */
export function StepEmail() {
  const stepper = useStepper();
  const store = useSignUpStore();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasHydrated, setHasHydrated] = useState(
    useSignUpStore.persist?.hasHydrated?.() ?? true
  );
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

  useEffect(() => {
    const persist = useSignUpStore.persist;
    if (!persist?.onFinishHydration) {
      setHasHydrated(true);
      return;
    }

    const unsubscribe = persist.onFinishHydration(() => {
      setHasHydrated(true);
    });
    if (persist.hasHydrated?.()) {
      setHasHydrated(true);
    }
    return () => {
      unsubscribe?.();
    };
  }, []);

  /**
   * Start fresh session - clears existing and creates new
   */
  const startFresh = useCallback(
    async (email: string | null) => {
      prepareForNewSession();
      store.reset();

      try {
        const result = await trpc.signUp.startSession.mutate({
          forceNew: true,
        });

        store.set({
          email,
          wizardStep: 2,
        });

        setFlowId(result.sessionId);
      } catch (error) {
        store.set({ email });
        setFlowId(null);
        throw error;
      }
    },
    [store]
  );

  const form = useForm({
    defaultValues: {
      email: store.email ?? "",
    },
    onSubmit: async ({ value }) => {
      const trimmed = value.email.trim();
      setIsSubmitting(true);

      try {
        await startFresh(trimmed);
        stepper.next();
      } catch {
        toast.error("Failed to start session");
      } finally {
        setIsSubmitting(false);
      }
    },
  });

  useEffect(() => {
    if (!hasHydrated) {
      return;
    }
    const savedEmail = store.email ?? "";
    const currentEmail = form.getFieldValue("email");
    if (!currentEmail && savedEmail) {
      form.setFieldValue("email", savedEmail);
    }
  }, [form, hasHydrated, store.email]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
    form.handleSubmit();
  };

  const handleSkip = useCallback(async () => {
    setIsSubmitting(true);
    try {
      form.reset();
      await startFresh(null);
      stepper.next();
    } catch {
      toast.error("Failed to start session");
    } finally {
      setIsSubmitting(false);
    }
  }, [form, stepper, startFresh]);

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
              ? field.state.meta.errors?.[0]
              : undefined;
            return (
              <Field data-invalid={isInvalid}>
                <FieldLabel htmlFor={emailId}>Email Address</FieldLabel>
                <Input
                  aria-invalid={isInvalid}
                  autoCapitalize="none"
                  autoComplete="email"
                  id={emailId}
                  inputMode="email"
                  name={field.name}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                  placeholder="you@example.com"
                  spellCheck={false}
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

      <StepperControls
        isSubmitting={isSubmitting}
        onNext={() => form.handleSubmit()}
        onSkip={handleSkip}
        showSkip
        skipLabel="Continue without email"
        stepper={stepper}
      />

      <div className="mt-6 text-center text-muted-foreground text-sm">
        Already have an account?{" "}
        <Link
          className="font-medium text-primary hover:underline"
          href="/sign-in"
        >
          Sign In
        </Link>
      </div>
    </form>
  );
}
