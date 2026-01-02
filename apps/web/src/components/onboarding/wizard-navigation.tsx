"use client";

import { Button } from "@/components/ui/button";

import { useWizard } from "./wizard-provider";

interface WizardNavigationProps {
  onNext?: () => void | Promise<void>;
  onSkip?: () => void | Promise<void>;
  nextLabel?: string;
  skipLabel?: string;
  showSkip?: boolean;
  disableNext?: boolean;
}

export function WizardNavigation({
  onNext,
  onSkip,
  nextLabel,
  skipLabel = "Skip for now",
  showSkip = false,
  disableNext = false,
}: WizardNavigationProps) {
  const { prevStep, nextStep, canGoBack, isLastStep, state } = useWizard();

  const handleNext = async () => {
    if (onNext) {
      await onNext();
    } else {
      nextStep();
    }
  };

  const handleSkip = async () => {
    if (onSkip) {
      await onSkip();
    } else {
      nextStep();
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-3">
        {canGoBack ? (
          <Button
            className="flex-1"
            disabled={state.isSubmitting}
            onClick={prevStep}
            type="button"
            variant="outline"
          >
            Back
          </Button>
        ) : null}
        <Button
          className="flex-1"
          disabled={disableNext || state.isSubmitting}
          onClick={onNext ? handleNext : undefined}
          type="submit"
        >
          {state.isSubmitting
            ? "Processing..."
            : (nextLabel ?? (isLastStep ? "Complete" : "Continue"))}
        </Button>
      </div>
      {showSkip ? (
        <Button
          className="text-muted-foreground"
          disabled={state.isSubmitting}
          onClick={handleSkip}
          type="button"
          variant="ghost"
        >
          {skipLabel}
        </Button>
      ) : null}
    </div>
  );
}
