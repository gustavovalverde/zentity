"use client";

import { useWizard } from "./wizard-provider";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
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
        <span className="font-medium">
          Step {state.currentStep} of {totalSteps}
        </span>
        <span className="text-muted-foreground">
          {STEP_TITLES[state.currentStep - 1]}
        </span>
      </div>
      <Progress value={progress} className="h-2" />

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
                "flex flex-col items-center gap-1 group",
                canNavigate && "cursor-pointer"
              )}
              aria-label={`${title} - Step ${stepNumber}${isCompleted ? " (completed)" : isCurrent ? " (current)" : ""}`}
              aria-current={isCurrent ? "step" : undefined}
            >
              <div
                className={cn(
                  "w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium transition-all",
                  isCompleted && "bg-primary text-primary-foreground",
                  isCurrent && "bg-primary text-primary-foreground ring-4 ring-primary/20",
                  !isCompleted && !isCurrent && "bg-muted text-muted-foreground",
                  canNavigate && "group-hover:ring-2 group-hover:ring-primary/30"
                )}
              >
                {isCompleted ? (
                  <Check className="w-4 h-4" />
                ) : (
                  stepNumber
                )}
              </div>
              <span
                className={cn(
                  "text-[10px] max-w-[60px] text-center leading-tight hidden sm:block",
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
