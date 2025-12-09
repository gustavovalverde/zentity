"use client";

import {
  StepEmail,
  StepIdUpload,
  StepReviewComplete,
  StepSelfie,
} from "./steps";
import { useWizard } from "./wizard-provider";
import { WizardStepper } from "./wizard-stepper";

/**
 * New 4-step wizard flow:
 * 1. Email - minimal friction to start
 * 2. ID Upload - upload document, extract data (name, DOB, etc.)
 * 3. Selfie/Liveness - face match + challenge
 * 4. Review & Complete - review extracted data, set password, create account
 */
const STEPS = [
  StepEmail, // Step 1: Just email
  StepIdUpload, // Step 2: Upload + extract data
  StepSelfie, // Step 3: Liveness verification
  StepReviewComplete, // Step 4: Review + password + create account
];

export function Wizard() {
  const { state } = useWizard();
  const StepComponent = STEPS[state.currentStep - 1];

  return (
    <div className="space-y-8">
      <WizardStepper />
      <StepComponent />
    </div>
  );
}
