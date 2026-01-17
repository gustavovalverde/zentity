"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { useOnboardingStore } from "@/lib/onboarding/store";
import { trpc } from "@/lib/trpc/client";

import { LivenessFlow } from "../liveness/liveness-flow";
import { LivenessProvider } from "../liveness/liveness-provider";
import { useStepper } from "./stepper-context";
import { StepperControls } from "./stepper-ui";

/**
 * Liveness verification step in onboarding wizard.
 *
 * Uses server-authoritative LivenessProvider - server is single source of truth.
 * This component handles only onboarding-specific concerns:
 * - Storing verification results
 * - Navigation via stepper
 * - Final submission to backend
 */
export function StepLiveness() {
  const stepper = useStepper();
  const store = useOnboardingStore();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [livenessCompleted, setLivenessCompleted] = useState(false);

  // Handle successful liveness verification
  const handleVerified = useCallback(
    ({
      selfieImage,
      bestSelfieFrame,
    }: Readonly<{
      selfieImage: string;
      bestSelfieFrame: string;
    }>) => {
      store.set({ selfieImage, bestSelfieFrame });
      setLivenessCompleted(true);
    },
    [store]
  );

  // Handle reset (user retrying)
  const handleReset = useCallback(() => {
    store.set({
      selfieImage: null,
      bestSelfieFrame: null,
    });
    setLivenessCompleted(false);
  }, [store]);

  // Handle session error (go back to email step)
  const handleSessionError = useCallback(() => {
    store.reset();
    stepper.goTo("email");
  }, [store, stepper]);

  // Submit liveness results for face match verification
  const handleSubmit = useCallback(async () => {
    const selfieToVerify = store.bestSelfieFrame || store.selfieImage;
    if (!selfieToVerify) {
      toast.error("Missing selfie", {
        description: "Please complete the liveness step before continuing.",
      });
      return;
    }

    if (!(store.idDocumentBase64 && store.identityDraftId)) {
      toast.error("Missing document context", {
        description:
          "Please re-upload your ID so we can complete verification.",
      });
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await trpc.identity.prepareLiveness.mutate({
        draftId: store.identityDraftId,
        documentImage: store.idDocumentBase64,
        selfieImage: selfieToVerify,
      });

      store.set({
        livenessPassed: response.livenessPassed,
        faceMatchPassed: response.faceMatchPassed,
      });

      stepper.next();
    } catch (error) {
      toast.error("Verification failed", {
        description:
          error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setIsSubmitting(false);
    }
  }, [stepper, store]);

  const disableNext = !livenessCompleted || isSubmitting;

  return (
    <div className="flex flex-col gap-6">
      <LivenessProvider
        onReset={handleReset}
        onSessionError={handleSessionError}
        onVerified={handleVerified}
      >
        <LivenessFlow />
      </LivenessProvider>

      <Alert>
        <AlertDescription>
          Your selfie is captured for face matching with your ID, then deleted
          after verification. Randomized gestures confirm you&apos;re a real
          person.
        </AlertDescription>
      </Alert>

      <StepperControls
        disableNext={disableNext}
        isSubmitting={isSubmitting}
        onNext={handleSubmit}
        stepper={stepper}
      />
    </div>
  );
}
