"use client";

import { Check } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { usePrefersReducedMotion } from "@/hooks/use-reduced-motion";
import { motion, reducedMotion } from "@/lib/utils/motion";
import { cn } from "@/lib/utils/utils";

import { useWizard } from "./wizard-provider";

const STEP_TITLES = ["Email", "Upload ID", "Liveness", "Create Account"];

export function WizardStepper() {
  const {
    state,
    totalSteps,
    progress,
    goToStepWithValidation,
    pendingNavigation,
    confirmPendingNavigation,
    cancelPendingNavigation,
  } = useWizard();
  const [isNavigating, setIsNavigating] = useState(false);
  const prefersReducedMotion = usePrefersReducedMotion();
  const m = prefersReducedMotion ? reducedMotion : motion;
  const headerRef = useRef<HTMLFieldSetElement>(null);
  const hasMountedRef = useRef(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: focus the step header on step transitions for keyboard/screen reader users.
  useEffect(() => {
    // Avoid stealing focus on initial mount (e.g., when a step input uses `autoFocus`).
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      return;
    }
    headerRef.current?.focus();
  }, [state.currentStep]);

  const handleStepClick = async (stepNumber: number) => {
    if (isNavigating) {
      return;
    }

    setIsNavigating(true);
    try {
      await goToStepWithValidation(stepNumber);
    } finally {
      setIsNavigating(false);
    }
  };

  return (
    <div className="space-y-4">
      <fieldset
        aria-label={`Onboarding progress: step ${state.currentStep} of ${totalSteps}`}
        className="flex items-center justify-between rounded-md border-0 px-1 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        ref={headerRef}
        tabIndex={-1}
      >
        <span className={cn("font-medium", m.fadeIn)}>
          Step {state.currentStep} of {totalSteps}
        </span>
        <span
          className={cn("text-muted-foreground", m.slideUp)}
          key={state.currentStep}
        >
          {STEP_TITLES[state.currentStep - 1]}
        </span>
      </fieldset>
      <Progress className={cn("h-2", m.progress)} value={progress} />

      {/* Visual step indicators */}
      <div className="flex items-center justify-between">
        {STEP_TITLES.map((title, index) => {
          const stepNumber = index + 1;
          const isCompleted = stepNumber < state.currentStep;
          const isCurrent = stepNumber === state.currentStep;
          // Allow navigating to completed steps (will show warning and reset progress)
          const canNavigate = stepNumber < state.currentStep && !isNavigating;

          return (
            <Button
              aria-current={isCurrent ? "step" : undefined}
              aria-label={(() => {
                const base = `${title} - Step ${stepNumber}`;
                if (isCompleted) {
                  return `${base} (completed)`;
                }
                if (isCurrent) {
                  return `${base} (current)`;
                }
                return base;
              })()}
              className={cn(
                // Ensure minimum 44px touch target for accessibility
                "group flex min-h-[44px] min-w-[44px] flex-col items-center gap-1 p-1 transition-transform duration-200",
                canNavigate && "hover:scale-105",
                isNavigating && "opacity-50"
              )}
              disabled={!canNavigate}
              key={stepNumber}
              onClick={() => canNavigate && handleStepClick(stepNumber)}
              type="button"
              variant="ghost"
            >
              <div
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-full font-medium text-xs transition-all duration-300",
                  isCompleted && "scale-100 bg-primary text-primary-foreground",
                  isCurrent &&
                    "scale-110 bg-primary text-primary-foreground ring-4 ring-primary/20",
                  !(isCompleted || isCurrent) &&
                    "scale-100 bg-muted text-muted-foreground",
                  canNavigate &&
                    "group-hover:ring-2 group-hover:ring-primary/30"
                )}
              >
                {isCompleted ? (
                  <Check
                    aria-hidden="true"
                    className="zoom-in h-4 w-4 animate-in duration-200"
                  />
                ) : (
                  <span
                    className={cn(
                      isCurrent && "zoom-in animate-in duration-200"
                    )}
                  >
                    {stepNumber}
                  </span>
                )}
              </div>
              <span
                className={cn(
                  "hidden max-w-[60px] text-center text-[10px] leading-tight transition-colors duration-200 sm:block",
                  isCurrent
                    ? "font-medium text-foreground"
                    : "text-muted-foreground"
                )}
              >
                {title}
              </span>
            </Button>
          );
        })}
      </div>

      <Dialog
        onOpenChange={(open) => {
          if (!open) {
            cancelPendingNavigation();
          }
        }}
        open={Boolean(pendingNavigation)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Go back to an earlier step?</DialogTitle>
            <DialogDescription>
              {pendingNavigation?.warning ||
                "Going back will reset progress for later steps."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              disabled={isNavigating}
              onClick={cancelPendingNavigation}
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
            <Button
              onClick={async () => {
                if (isNavigating) {
                  return;
                }
                setIsNavigating(true);
                try {
                  await confirmPendingNavigation();
                } finally {
                  setIsNavigating(false);
                }
              }}
              type="button"
            >
              Go back
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
