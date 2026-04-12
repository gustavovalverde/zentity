"use client";

import { useCallback, useMemo, useState } from "react";

import {
  TRANSITIONS,
  type VerificationStep,
} from "@/lib/identity/verification/steps";

// ---------------------------------------------------------------------------
// Step transitions for the verification flow
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// OPAQUE / wallet re-auth dialog state
// ---------------------------------------------------------------------------

type VerificationBindingAuthMode = "opaque" | "wallet";

/**
 * Shared dialog state for verification flows that need OPAQUE or wallet
 * re-authentication before continuing.
 */
export function useVerificationBindingAuth() {
  const [bindingAuthOpen, setBindingAuthOpen] = useState(false);
  const [bindingAuthMode, setBindingAuthMode] =
    useState<VerificationBindingAuthMode>("opaque");

  const requestBindingAuth = useCallback(
    (mode: VerificationBindingAuthMode) => {
      setBindingAuthMode(mode);
      setBindingAuthOpen(true);
    },
    []
  );

  return {
    bindingAuthMode,
    bindingAuthOpen,
    requestBindingAuth,
    setBindingAuthOpen,
  };
}
