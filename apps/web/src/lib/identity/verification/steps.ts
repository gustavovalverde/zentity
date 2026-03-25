/**
 * Verification Step Model
 *
 * Defines the directed graph of verification steps and a pure function
 * to compute the initial step from assurance state. Used by both the
 * server component (to seed the step) and the client stepper hook.
 */

import type { AccountAssurance } from "@/lib/assurance/types";

export type VerificationStep =
  | "enrollment"
  | "method"
  | "document"
  | "liveness"
  | "passport-chip";

/** Directed graph of valid step transitions. */
export const TRANSITIONS: Record<VerificationStep, VerificationStep[]> = {
  enrollment: ["method"],
  method: ["document", "passport-chip"],
  document: ["liveness"],
  liveness: [],
  "passport-chip": [],
};

export interface InitialStepContext {
  missingProfileSecret: boolean;
  resetOnMount: boolean;
}

interface InitialStepResult {
  context: InitialStepContext;
  step: VerificationStep;
}

/**
 * Compute the initial verification step from assurance state.
 *
 * Returns null when the user should be redirected away (tier >= 3 with
 * no missing profile secret, or tier >= 2 without zkPassport upgrade path).
 */
export function computeInitialStep(
  assurance: AccountAssurance,
  options: { hasEnrollment: boolean; zkPassportEnabled: boolean }
): InitialStepResult | null {
  const { tier, details } = assurance;
  const { hasEnrollment, zkPassportEnabled } = options;

  // Fully verified — redirect to dashboard
  if (tier >= 3 && !details.missingProfileSecret) {
    return null;
  }

  // Missing profile secret — re-verify from method selection
  if (tier >= 2 && details.missingProfileSecret) {
    return {
      step: "method",
      context: { missingProfileSecret: true, resetOnMount: false },
    };
  }

  // Tier 2 with zkPassport — upgrade path
  if (tier >= 2 && zkPassportEnabled) {
    return {
      step: "method",
      context: { missingProfileSecret: false, resetOnMount: false },
    };
  }

  // Tier 2 without zkPassport — nothing to do
  if (tier >= 2) {
    return null;
  }

  const defaultContext: InitialStepContext = {
    missingProfileSecret: false,
    resetOnMount: false,
  };

  // No FHE enrollment yet — start there
  if (!hasEnrollment) {
    return { step: "enrollment", context: defaultContext };
  }

  // Has incomplete proofs (identity done but proofs failed) — retry from document
  if (details.hasIncompleteProofs || details.needsDocumentReprocessing) {
    return {
      step: "document",
      context: { missingProfileSecret: false, resetOnMount: true },
    };
  }

  // Document done, liveness not — resume at liveness
  if (details.documentVerified && !details.livenessVerified) {
    return { step: "liveness", context: defaultContext };
  }

  // Default: start at method selection
  return { step: "method", context: defaultContext };
}
