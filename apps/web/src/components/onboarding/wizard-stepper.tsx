"use client";

import { useWizard } from "./wizard-provider";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { motion } from "@/lib/motion";
import { Check } from "lucide-react";

const STEP_TITLES = [
  "Email",
  "Upload ID",
  "Liveness",
  "Complete",
];

export function WizardStepper() {
  const { state, totalSteps, progress, goToStep } = useWizard();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between text-sm">
        <span className={cn("font-medium", motion.fadeIn)}>
          Step {state.currentStep} of {totalSteps}
        </span>
        <span
          key={state.currentStep}
          className={cn("text-muted-foreground", motion.slideUp)}
        >
          {STEP_TITLES[state.currentStep - 1]}
        </span>
      </div>
      <Progress value={progress} className={cn("h-2", motion.progress)} />

      {/* Visual step indicators */}
      <div className="flex justify-between items-center">
        {STEP_TITLES.map((title, index) => {
          const stepNumber = index + 1;
          const isCompleted = stepNumber < state.currentStep;
          const isCurrent = stepNumber === state.currentStep;
          const canNavigate = stepNumber < state.currentStep;

          return (
            <button
              key={stepNumber}
              onClick={() => canNavigate && goToStep(stepNumber)}
              disabled={!canNavigate}
              className={cn(
                // Ensure minimum 44px touch target for accessibility
                "flex flex-col items-center gap-1 group transition-transform duration-200 min-w-[44px] min-h-[44px] p-1",
                canNavigate && "cursor-pointer hover:scale-105"
              )}
              aria-label={`${title} - Step ${stepNumber}${isCompleted ? " (completed)" : isCurrent ? " (current)" : ""}`}
              aria-current={isCurrent ? "step" : undefined}
            >
              <div
                className={cn(
                  "w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium transition-all duration-300",
                  isCompleted && "bg-primary text-primary-foreground scale-100",
                  isCurrent && "bg-primary text-primary-foreground ring-4 ring-primary/20 scale-110",
                  !isCompleted && !isCurrent && "bg-muted text-muted-foreground scale-100",
                  canNavigate && "group-hover:ring-2 group-hover:ring-primary/30"
                )}
              >
                {isCompleted ? (
                  <Check className="w-4 h-4 animate-in zoom-in duration-200" aria-hidden="true" />
                ) : (
                  <span className={cn(isCurrent && "animate-in zoom-in duration-200")}>
                    {stepNumber}
                  </span>
                )}
              </div>
              <span
                className={cn(
                  "text-[10px] max-w-[60px] text-center leading-tight hidden sm:block transition-colors duration-200",
                  isCurrent ? "text-foreground font-medium" : "text-muted-foreground"
                )}
              >
                {title}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
