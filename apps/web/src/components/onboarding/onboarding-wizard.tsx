"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Spinner } from "@/components/ui/spinner";
import { prepareForNewSession } from "@/lib/auth/session-manager";
import { setOnboardingFlowId } from "@/lib/observability/flow-client";
import { trpc } from "@/lib/trpc/client";

import { useOnboardingStore } from "./onboarding-store";
import { StepEmail } from "./step-email";
import { Stepper, steps, useStepper } from "./stepper-context";
import { StepperHeader } from "./stepper-ui";

// Direct store access for effects (avoids dependency array issues)
const getStoreState = () => useOnboardingStore.getState();

// Dynamic imports for heavy step components
function StepLoading({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12 text-muted-foreground">
      <Spinner size="lg" />
      <span className="text-sm">{label}</span>
    </div>
  );
}

const StepIdUpload = dynamic(
  () => import("./step-id-upload").then((mod) => mod.StepIdUpload),
  { ssr: false, loading: () => <StepLoading label="Loading document step…" /> }
);

const StepLiveness = dynamic(
  () => import("./step-liveness").then((mod) => mod.StepLiveness),
  { ssr: false, loading: () => <StepLoading label="Loading camera step…" /> }
);

const StepAccount = dynamic(
  () => import("./step-account").then((mod) => mod.StepAccount),
  { ssr: false, loading: () => <StepLoading label="Loading account step…" /> }
);

const STEP_COMPONENTS = {
  email: StepEmail,
  "id-upload": StepIdUpload,
  liveness: StepLiveness,
  account: StepAccount,
} as const;

type StepId = keyof typeof STEP_COMPONENTS;

/**
 * WizardContent - Inner component that uses the stepper context
 */
function WizardContent() {
  const stepper = useStepper();
  const [isHydrated, setIsHydrated] = useState(false);
  const hydrationStartedRef = useRef(false);

  // Use selectors for reactive values (stable references)
  const hasIdDocument = useOnboardingStore((s) => !!s.idDocument);
  const hasSelfieImage = useOnboardingStore((s) => !!s.selfieImage);

  // Hydrate store from server on mount
  // Note: Uses getStoreState() instead of store in deps to avoid infinite loops
  useEffect(() => {
    if (isHydrated || hydrationStartedRef.current) {
      return;
    }
    hydrationStartedRef.current = true;

    const hydrate = async () => {
      try {
        const serverState = await trpc.onboarding.getSession.query();

        if (
          serverState?.hasSession &&
          "sessionId" in serverState &&
          serverState.sessionId
        ) {
          // Restore from server (direct access, no subscription)
          getStoreState().set({
            sessionId: serverState.sessionId,
            identityDraftId: serverState.identityDraftId ?? null,
            documentProcessed: serverState.documentProcessed ?? false,
            livenessPassed: serverState.livenessPassed ?? false,
            faceMatchPassed: serverState.faceMatchPassed ?? false,
            keysSecured: serverState.keysSecured ?? false,
          });

          // Navigate to correct step
          const step = serverState.step ?? 1;
          const normalizedStep = Math.min(step, steps.length);
          const stepId = steps[normalizedStep - 1]?.id;
          if (stepId && stepId !== stepper.current.id) {
            stepper.goTo(stepId);
          }

          setOnboardingFlowId(serverState.sessionId);
        } else {
          if (serverState?.wasCleared) {
            toast.info("Session expired. Please start again.");
          }
          getStoreState().reset();
          setOnboardingFlowId(null);
        }
      } catch {
        // Server not available, continue with local state
      } finally {
        setIsHydrated(true);
      }
    };

    hydrate();
  }, [isHydrated, stepper]);

  // Warn before navigation with unsaved data
  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    const hasUnsavedData = hasIdDocument || hasSelfieImage;
    const currentIndex = steps.findIndex((s) => s.id === stepper.current.id);
    const isInProgress = currentIndex > 0 && currentIndex < steps.length - 1;

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedData && isInProgress) {
        e.preventDefault();
        e.returnValue = "";
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isHydrated, hasIdDocument, hasSelfieImage, stepper.current.id]);

  // Cleanup flow ID on unmount
  useEffect(() => () => setOnboardingFlowId(null), []);

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

  const StepComponent = STEP_COMPONENTS[stepper.current.id as StepId];

  return (
    <div className="space-y-8">
      <StepperHeader stepper={stepper} />
      <StepComponent />
    </div>
  );
}

/**
 * OnboardingWizard - Main export
 *
 * Wraps the wizard content with the stepperize provider.
 * Optionally forces a fresh start if forceReset is true.
 */
export function OnboardingWizard({ forceReset }: { forceReset?: boolean }) {
  const [isReady, setIsReady] = useState(!forceReset);
  const resetStartedRef = useRef(false);

  // Handle force reset
  // Note: Uses getStoreState() instead of store in deps to avoid infinite loops
  // See: https://blog.logrocket.com/solve-react-useeffect-hook-infinite-loop-patterns/
  useEffect(() => {
    if (!forceReset || resetStartedRef.current) {
      return;
    }
    resetStartedRef.current = true;

    const reset = async () => {
      try {
        await trpc.onboarding.clearSession.mutate();
      } catch {
        // Ignore - may not have a session to clear
      }
      prepareForNewSession();
      getStoreState().reset(); // Direct access, no subscription
      setOnboardingFlowId(null);
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
