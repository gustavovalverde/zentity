"use client";

import { useCallback, useMemo, useState } from "react";

import {
  TRANSITIONS,
  type VerificationStep,
} from "@/lib/identity/verification/steps";

interface VerificationStepper {
  canGoTo: (target: VerificationStep) => boolean;
  currentStep: VerificationStep;
  goTo: (target: VerificationStep) => void;
  reset: () => void;
  visitedSteps: ReadonlySet<VerificationStep>;
}

export function useVerificationStepper(
  initialStep: VerificationStep
): VerificationStepper {
  const [currentStep, setCurrentStep] = useState(initialStep);
  const [visitedSteps, setVisitedSteps] = useState<Set<VerificationStep>>(
    () => new Set([initialStep])
  );

  const canGoTo = useCallback(
    (target: VerificationStep): boolean => {
      return TRANSITIONS[currentStep].includes(target);
    },
    [currentStep]
  );

  const goTo = useCallback(
    (target: VerificationStep): void => {
      if (!TRANSITIONS[currentStep].includes(target)) {
        throw new Error(
          `Invalid transition: "${currentStep}" → "${target}". Valid targets: ${TRANSITIONS[currentStep].join(", ") || "none"}`
        );
      }
      setCurrentStep(target);
      setVisitedSteps((prev) => new Set([...prev, target]));
    },
    [currentStep]
  );

  const reset = useCallback(() => {
    setCurrentStep(initialStep);
    setVisitedSteps(new Set([initialStep]));
  }, [initialStep]);

  return useMemo(
    () => ({
      currentStep,
      visitedSteps,
      canGoTo,
      goTo,
      reset,
    }),
    [currentStep, visitedSteps, canGoTo, goTo, reset]
  );
}
