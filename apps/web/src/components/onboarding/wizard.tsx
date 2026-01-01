"use client";

import dynamic from "next/dynamic";

import { Spinner } from "@/components/ui/spinner";

import { StepEmail } from "./steps/step-email";
import { useWizard } from "./wizard-provider";
import { WizardStepper } from "./wizard-stepper";

function WizardStepLoading({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12 text-muted-foreground">
      <Spinner size="lg" />
      <span className="text-sm">{label}</span>
    </div>
  );
}

/**
 * Passwordless-first 4-step wizard flow:
 * 1. Email - minimal friction to start
 * 2. ID Upload - upload document, extract data (name, DOB, etc.)
 * 3. Selfie/Liveness - face match + challenge
 * 4. Create Account - review data, passkey registration, FHE keys, privacy proofs
 */
const StepIdUpload = dynamic(
  () => import("./steps/step-id-upload").then((mod) => mod.StepIdUpload),
  {
    ssr: false,
    loading: () => <WizardStepLoading label="Loading document step..." />,
  },
);

const StepSelfie = dynamic(
  () => import("./steps/step-selfie").then((mod) => mod.StepSelfie),
  {
    ssr: false,
    loading: () => <WizardStepLoading label="Loading camera step..." />,
  },
);

const StepCreateAccount = dynamic(
  () =>
    import("./steps/step-create-account").then((mod) => mod.StepCreateAccount),
  {
    ssr: false,
    loading: () => <WizardStepLoading label="Loading account step..." />,
  },
);

const STEPS = [
  StepEmail, // Step 1: Just email
  StepIdUpload, // Step 2: Upload + extract data
  StepSelfie, // Step 3: Liveness verification
  StepCreateAccount, // Step 4: Review + passkey + FHE keys + proofs
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
