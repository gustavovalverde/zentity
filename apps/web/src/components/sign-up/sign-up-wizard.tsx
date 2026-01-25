"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Spinner } from "@/components/ui/spinner";
import { prepareForNewSession } from "@/lib/auth/session-manager";
import { setFlowId } from "@/lib/observability/flow-client";
import { prewarmTfheWorker } from "@/lib/privacy/fhe/keygen-client";
import { trpc } from "@/lib/trpc/client";
import { useSignUpStore } from "@/store/sign-up";

import { StepEmail } from "./step-email";
import { Stepper, steps, useStepper } from "./stepper-config";
import { StepperNavigation } from "./stepper-ui";

// Direct store access for effects (avoids dependency array issues)
const getStoreState = () => useSignUpStore.getState();

// Dynamic imports for heavy step components (stepperize pattern with lazy loading)
function StepLoading({ label }: Readonly<{ label: string }>) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12 text-muted-foreground">
      <Spinner size="lg" />
      <span className="text-sm">{label}</span>
    </div>
  );
}

const StepAccount = dynamic(
  () => import("./step-account").then((mod) => mod.StepAccount),
  { ssr: false, loading: () => <StepLoading label="Loading account step…" /> }
);

/**
 * Step renderers for progressive sign-up
 *
 * The flow is simplified to 2 steps:
 * 1. Email (optional) - Users can skip this and proceed anonymously
 * 2. Account - Create account with passkey or password
 *
 * Identity verification (document, liveness, face match) is done
 * later from the dashboard, enabling progressive trust levels.
 */
const STEP_RENDERERS = {
  email: () => <StepEmail />,
  account: () => <StepAccount />,
} as const;

/**
 * WizardContent - Inner component that uses the stepper context
 */
function WizardContent() {
  const stepper = useStepper();
  const [isHydrated, setIsHydrated] = useState(false);
  const hydrationStartedRef = useRef(false);

  // Hydrate store from server on mount
  // Note: Uses getStoreState() instead of store in deps to avoid infinite loops
  useEffect(() => {
    if (isHydrated || hydrationStartedRef.current) {
      return;
    }
    hydrationStartedRef.current = true;

    const hydrate = async () => {
      try {
        const serverState = await trpc.signUp.getSession.query();

        if (
          serverState?.hasSession &&
          "sessionId" in serverState &&
          serverState.sessionId
        ) {
          // If user already completed sign-up (keysSecured), redirect to dashboard
          if (serverState.keysSecured) {
            globalThis.window.location.href = "/dashboard";
            return;
          }

          // Restore wizard step from server
          const step = serverState.step ?? 1;
          const wizardStep = Math.min(step, 3) as 1 | 2 | 3;
          getStoreState().set({ wizardStep });

          // Navigate to correct step
          const normalizedStep = Math.min(step, steps.length);
          const stepId = steps[normalizedStep - 1]?.id;
          if (stepId && stepId !== stepper.current.id) {
            stepper.goTo(stepId);
          }

          setFlowId(serverState.sessionId);
        } else {
          if (serverState?.wasCleared) {
            toast.info("Session expired. Please start again.");
          }
          getStoreState().reset();
          setFlowId(null);
        }
      } catch {
        // Server not available, continue with local state
      } finally {
        setIsHydrated(true);
        // Pre-warm TFHE worker while user completes earlier steps
        prewarmTfheWorker();
      }
    };

    hydrate();
  }, [isHydrated, stepper]);

  // Cleanup flow ID on unmount
  useEffect(() => () => setFlowId(null), []);

  if (!isHydrated) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Spinner size="sm" />
          <span>Loading…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <StepperNavigation stepper={stepper} />

      {/* Step content - stepperize switch pattern */}
      {stepper.switch(STEP_RENDERERS)}
    </div>
  );
}

/**
 * SignUpWizard - Main export
 *
 * Wraps the wizard content with the stepperize provider.
 * Optionally forces a fresh start if forceReset is true.
 */
export function SignUpWizard({
  forceReset,
}: Readonly<{ forceReset?: boolean }>) {
  const [isReady, setIsReady] = useState(!forceReset);
  const resetStartedRef = useRef(false);

  // Handle force reset
  // Note: Uses getStoreState() instead of store in deps to avoid infinite loops
  useEffect(() => {
    if (!forceReset || resetStartedRef.current) {
      return;
    }
    resetStartedRef.current = true;

    const reset = async () => {
      try {
        await trpc.signUp.clearSession.mutate();
      } catch {
        // Ignore - may not have a session to clear
      }
      prepareForNewSession();
      getStoreState().reset();
      setFlowId(null);
      setIsReady(true);
    };

    reset();
  }, [forceReset]);

  if (!isReady) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Spinner size="sm" />
          <span>Starting fresh…</span>
        </div>
      </div>
    );
  }

  return (
    <Stepper.Provider className="space-y-8" initialStep="email">
      <WizardContent />
    </Stepper.Provider>
  );
}
