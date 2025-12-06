"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useWizard } from "../wizard-provider";
import { WizardNavigation } from "../wizard-navigation";
import {
  emailSchema,
  EmailData,
} from "@/features/auth/schemas/sign-up.schema";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";

/**
 * Step 1: Email Only
 *
 * Minimal friction start - just collect email.
 * Password will be collected at the end after verification.
 */
export function StepEmail() {
  const { state, updateData, nextStep } = useWizard();

  const form = useForm<EmailData>({
    resolver: zodResolver(emailSchema),
    defaultValues: {
      email: state.data.email,
    },
  });

  const onSubmit = (data: EmailData) => {
    updateData(data);
    nextStep();
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <div className="space-y-2">
          <h3 className="text-lg font-medium">Get Started</h3>
          <p className="text-sm text-muted-foreground">
            Enter your email to begin identity verification.
          </p>
        </div>

        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email Address</FormLabel>
              <FormControl>
                <Input
                  type="email"
                  placeholder="you@example.com"
                  autoComplete="email"
                  autoFocus
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <p className="text-xs text-muted-foreground">
          We'll use this email to contact you if needed and for account recovery.
        </p>

        <WizardNavigation />
      </form>
    </Form>
  );
}
