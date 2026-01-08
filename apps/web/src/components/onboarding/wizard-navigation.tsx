"use client";

import type { ComponentProps } from "react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

import { useWizard } from "./wizard-provider";

interface WizardNavigationProps {
  onNext?: () => void | Promise<void>;
  onSkip?: () => void | Promise<void>;
  nextLabel?: string;
  skipLabel?: string;
  skipVariant?: ComponentProps<typeof Button>["variant"];
  showSkip?: boolean;
  disableNext?: boolean;
}

export function WizardNavigation({
  onNext,
  onSkip,
  nextLabel,
  skipLabel = "Skip for now",
  skipVariant = "ghost",
  showSkip = false,
  disableNext = false,
}: WizardNavigationProps) {
  const { prevStep, nextStep, canGoBack, isLastStep, state } = useWizard();
  const primaryLabel = nextLabel ?? (isLastStep ? "Complete" : "Continue");

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
          {state.isSubmitting ? (
            <>
              <Spinner aria-hidden="true" className="mr-2" size="sm" />
              {primaryLabel}
            </>
          ) : (
            primaryLabel
          )}
        </Button>
      </div>
      {showSkip ? (
        <Button
          className={
            skipVariant === "ghost" ? "text-muted-foreground" : undefined
          }
          disabled={state.isSubmitting}
          onClick={handleSkip}
          type="button"
          variant={skipVariant}
        >
          {skipLabel}
        </Button>
      ) : null}
    </div>
  );
}
