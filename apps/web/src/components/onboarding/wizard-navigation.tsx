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
  nextLabel = "Continue",
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
        {canGoBack && (
          <Button
            type="button"
            variant="outline"
            onClick={prevStep}
            disabled={state.isSubmitting}
            className="flex-1"
          >
            Back
          </Button>
        )}
        <Button
          type="submit"
          onClick={onNext ? handleNext : undefined}
          disabled={disableNext || state.isSubmitting}
          className="flex-1"
        >
          {state.isSubmitting
            ? "Processing..."
            : isLastStep
              ? "Complete"
              : nextLabel}
        </Button>
      </div>
      {showSkip && (
        <Button
          type="button"
          variant="ghost"
          onClick={handleSkip}
          disabled={state.isSubmitting}
          className="text-muted-foreground"
        >
          {skipLabel}
        </Button>
      )}
    </div>
  );
}
