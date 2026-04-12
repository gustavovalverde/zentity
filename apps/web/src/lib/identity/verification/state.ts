"use client";

/**
 * Verification client state.
 *
 * Zustand store + hooks that drive the identity verification flow in the
 * browser. State is in-memory only: PII (DOB, document images, nationality)
 * must never be written to sessionStorage, localStorage, or URL params.
 * Client-side navigation preserves this state between verification steps;
 * a page refresh resets the user to the initial step.
 */

import type { DocumentResult } from "@/lib/identity/document/document-ocr";

import { useCallback, useMemo, useState } from "react";
import { create } from "zustand";

import {
  TRANSITIONS,
  type VerificationStep,
} from "@/lib/identity/verification/steps";

// ---------------------------------------------------------------------------
// Transient verification store
// ---------------------------------------------------------------------------

interface VerificationStore {
  bestSelfieFrame: string | null;
  documentResult: DocumentResult | null;
  draftId: string | null;
  extractedDOB: string | null;
  extractedDocNumber: string | null;
  extractedExpirationDate: string | null;
  extractedFirstName: string | null;
  extractedLastName: string | null;
  extractedName: string | null;
  extractedNationality: string | null;
  extractedNationalityCode: string | null;
  idDocument: File | null;
  idDocumentBase64: string | null;
  reset: () => void;
  selfieImage: string | null;
  set: (data: Partial<Omit<VerificationStore, "set" | "reset">>) => void;
  userSalt: string | null;
  verificationId: string | null;
}

const initialState: Omit<VerificationStore, "set" | "reset"> = {
  draftId: null,
  verificationId: null,
  idDocument: null,
  idDocumentBase64: null,
  documentResult: null,
  selfieImage: null,
  bestSelfieFrame: null,
  extractedName: null,
  extractedFirstName: null,
  extractedLastName: null,
  extractedDOB: null,
  extractedDocNumber: null,
  extractedNationality: null,
  extractedNationalityCode: null,
  extractedExpirationDate: null,
  userSalt: null,
};

export const useVerificationStore = create<VerificationStore>()((set) => ({
  ...initialState,
  set: (data) => set(data),
  reset: () => set(initialState),
}));

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
