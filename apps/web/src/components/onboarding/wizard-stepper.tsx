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
import { motion, reducedMotion } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { useWizard } from "./wizard-provider";

const STEP_TITLES = ["Email", "Upload ID", "Liveness", "Complete"];

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
  const headerRef = useRef<HTMLDivElement>(null);
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
    if (isNavigating) return;

    setIsNavigating(true);
    try {
      await goToStepWithValidation(stepNumber);
    } finally {
      setIsNavigating(false);
    }
  };

  return (
    <div className="space-y-4">
      <div
        ref={headerRef}
        tabIndex={-1}
        className="flex items-center justify-between text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-md px-1"
        role="group"
        aria-label={`Onboarding progress: step ${state.currentStep} of ${totalSteps}`}
      >
        <span className={cn("font-medium", m.fadeIn)}>
          Step {state.currentStep} of {totalSteps}
        </span>
        <span
          key={state.currentStep}
          className={cn("text-muted-foreground", m.slideUp)}
        >
          {STEP_TITLES[state.currentStep - 1]}
        </span>
      </div>
      <Progress value={progress} className={cn("h-2", m.progress)} />

      {/* Visual step indicators */}
      <div className="flex justify-between items-center">
        {STEP_TITLES.map((title, index) => {
          const stepNumber = index + 1;
          const isCompleted = stepNumber < state.currentStep;
          const isCurrent = stepNumber === state.currentStep;
          // Allow navigating to completed steps (will show warning and reset progress)
          const canNavigate = stepNumber < state.currentStep && !isNavigating;

          return (
            <button
              type="button"
              key={stepNumber}
              onClick={() => canNavigate && handleStepClick(stepNumber)}
              disabled={!canNavigate}
              className={cn(
                // Ensure minimum 44px touch target for accessibility
                "flex flex-col items-center gap-1 group transition-transform duration-200 min-w-[44px] min-h-[44px] p-1",
                canNavigate && "cursor-pointer hover:scale-105",
                isNavigating && "opacity-50 cursor-not-allowed",
              )}
              aria-label={`${title} - Step ${stepNumber}${isCompleted ? " (completed)" : isCurrent ? " (current)" : ""}`}
              aria-current={isCurrent ? "step" : undefined}
            >
              <div
                className={cn(
                  "w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium transition-all duration-300",
                  isCompleted && "bg-primary text-primary-foreground scale-100",
                  isCurrent &&
                    "bg-primary text-primary-foreground ring-4 ring-primary/20 scale-110",
                  !isCompleted &&
                    !isCurrent &&
                    "bg-muted text-muted-foreground scale-100",
                  canNavigate &&
                    "group-hover:ring-2 group-hover:ring-primary/30",
                )}
              >
                {isCompleted ? (
                  <Check
                    className="w-4 h-4 animate-in zoom-in duration-200"
                    aria-hidden="true"
                  />
                ) : (
                  <span
                    className={cn(
                      isCurrent && "animate-in zoom-in duration-200",
                    )}
                  >
                    {stepNumber}
                  </span>
                )}
              </div>
              <span
                className={cn(
                  "text-[10px] max-w-[60px] text-center leading-tight hidden sm:block transition-colors duration-200",
                  isCurrent
                    ? "text-foreground font-medium"
                    : "text-muted-foreground",
                )}
              >
                {title}
              </span>
            </button>
          );
        })}
      </div>

      <Dialog
        open={Boolean(pendingNavigation)}
        onOpenChange={(open) => {
          if (!open) cancelPendingNavigation();
        }}
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
              type="button"
              variant="outline"
              onClick={cancelPendingNavigation}
              disabled={isNavigating}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={async () => {
                if (isNavigating) return;
                setIsNavigating(true);
                try {
                  await confirmPendingNavigation();
                } finally {
                  setIsNavigating(false);
                }
              }}
            >
              Go back
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
