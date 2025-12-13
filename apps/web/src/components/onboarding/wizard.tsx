"use client";

import dynamic from "next/dynamic";
import { StepEmail } from "./steps/step-email";
import { useWizard } from "./wizard-provider";
import { WizardStepper } from "./wizard-stepper";

/**
 * New 4-step wizard flow:
 * 1. Email - minimal friction to start
 * 2. ID Upload - upload document, extract data (name, DOB, etc.)
 * 3. Selfie/Liveness - face match + challenge
 * 4. Review & Complete - review extracted data, set password, create account
 */
const StepIdUpload = dynamic(
  () => import("./steps/step-id-upload").then((mod) => mod.StepIdUpload),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center py-12">
        <div className="animate-pulse text-muted-foreground">
          Loading document step...
        </div>
      </div>
    ),
  },
);

const StepSelfie = dynamic(
  () => import("./steps/step-selfie").then((mod) => mod.StepSelfie),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center py-12">
        <div className="animate-pulse text-muted-foreground">
          Loading camera step...
        </div>
      </div>
    ),
  },
);

const StepReviewComplete = dynamic(
  () =>
    import("./steps/step-review-complete").then(
      (mod) => mod.StepReviewComplete,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center py-12">
        <div className="animate-pulse text-muted-foreground">
          Loading final step...
        </div>
      </div>
    ),
  },
);

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
