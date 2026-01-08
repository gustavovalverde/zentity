"use client";

import type { StepId } from "./stepper-context";

import { Check } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

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
import { Spinner } from "@/components/ui/spinner";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils/utils";

import { type OnboardingStore, useOnboardingStore } from "./onboarding-store";

/**
 * Types for stepper from stepperize
 *
 * Uses StepId from stepper-context for type-safe navigation.
 */
interface Step {
  id: StepId;
  title: string;
}

interface StepperMethods {
  current: Step;
  isFirst: boolean;
  isLast: boolean;
  all: Step[];
  goTo: (id: StepId) => void;
  next: () => void;
  prev: () => void;
}

/**
 * StepperHeader - Visual step indicators with progress bar
 */
export function StepperHeader({ stepper }: { stepper: StepperMethods }) {
  const [isNavigating, setIsNavigating] = useState(false);
  const [pendingBack, setPendingBack] = useState<{
    stepId: StepId;
    warning: string;
  } | null>(null);

  const steps = stepper.all;
  const currentIndex = steps.findIndex((s) => s.id === stepper.current.id);
  const progress = ((currentIndex + 1) / steps.length) * 100;

  const handleStepClick = async (stepId: StepId) => {
    const targetIndex = steps.findIndex((s) => s.id === stepId);
    if (targetIndex >= currentIndex || isNavigating) {
      return;
    }

    setIsNavigating(true);
    try {
      const result = await trpc.onboarding.validateStep.mutate({
        targetStep: (targetIndex + 1) as 1 | 2 | 3 | 4 | 5,
      });

      if (!result.valid) {
        toast.error(result.error || "Cannot navigate to this step");
        return;
      }

      if (result.requiresConfirmation && result.warning) {
        setPendingBack({ stepId, warning: result.warning });
        return;
      }

      stepper.goTo(stepId);
    } catch {
      toast.error("Failed to validate step");
    } finally {
      setIsNavigating(false);
    }
  };

  const confirmBack = async () => {
    if (!pendingBack) {
      return;
    }

    const store = useOnboardingStore.getState();
    setIsNavigating(true);

    try {
      const targetIndex = steps.findIndex((s) => s.id === pendingBack.stepId);
      await trpc.onboarding.resetToStep.mutate({
        step: (targetIndex + 1) as 1 | 2 | 3 | 4 | 5,
      });

      const resetState: Partial<OnboardingStore> = {};

      // Reset document + extracted data when returning to ID upload or earlier
      if (targetIndex <= 1) {
        resetState.documentProcessed = false;
        resetState.identityDraftId = null;
        resetState.extractedName = null;
        resetState.extractedDOB = null;
        resetState.extractedDocNumber = null;
        resetState.extractedNationality = null;
        resetState.extractedNationalityCode = null;
        resetState.extractedExpirationDate = null;
        resetState.userSalt = null;
        resetState.idDocument = null;
        resetState.idDocumentBase64 = null;
        resetState.documentResult = null;
      }

      // Reset liveness data when returning to liveness or earlier
      if (targetIndex <= 2) {
        resetState.livenessPassed = false;
        resetState.faceMatchPassed = false;
        resetState.selfieImage = null;
        resetState.bestSelfieFrame = null;
        resetState.blinkCount = null;
      }

      // Reset account/finalization data when returning from the account step
      if (targetIndex <= 3) {
        resetState.keysSecured = false;
        resetState.preferredName = null;
        resetState.identityDocumentId = null;
      }

      store.set(resetState);

      stepper.goTo(pendingBack.stepId);
      setPendingBack(null);
    } catch {
      toast.error("Failed to reset progress");
    } finally {
      setIsNavigating(false);
    }
  };

  return (
    <div className="space-y-4">
      <fieldset
        aria-label={`Onboarding progress: step ${currentIndex + 1} of ${steps.length}`}
        className="flex items-center justify-between rounded-md border-0 px-1 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        <span className="font-medium">
          Step {currentIndex + 1} of {steps.length}
        </span>
        <span className="text-muted-foreground">{stepper.current.title}</span>
      </fieldset>

      <Progress className="h-2" value={progress} />

      <div className="flex items-center justify-between">
        {steps.map((step, index) => {
          const isCompleted = index < currentIndex;
          const isCurrent = index === currentIndex;
          const canNavigate = isCompleted && !isNavigating;

          const getStepStatus = () => {
            if (isCompleted) {
              return " (completed)";
            }
            if (isCurrent) {
              return " (current)";
            }
            return "";
          };
          const stepStatus = getStepStatus();

          return (
            <Button
              aria-current={isCurrent ? "step" : undefined}
              aria-label={`${step.title} - Step ${index + 1}${stepStatus}`}
              className={cn(
                "group flex min-h-[44px] min-w-[44px] flex-col items-center gap-1 p-1 transition-transform duration-200",
                canNavigate && "hover:scale-105",
                isNavigating && "opacity-50"
              )}
              disabled={!canNavigate}
              key={step.id}
              onClick={() => canNavigate && handleStepClick(step.id)}
              type="button"
              variant="ghost"
            >
              <div
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-full font-medium text-xs transition-all duration-300",
                  isCompleted && "bg-primary text-primary-foreground",
                  isCurrent &&
                    "scale-110 bg-primary text-primary-foreground ring-4 ring-primary/20",
                  !(isCompleted || isCurrent) &&
                    "bg-muted text-muted-foreground",
                  canNavigate &&
                    "group-hover:ring-2 group-hover:ring-primary/30"
                )}
              >
                {isCompleted ? (
                  <Check aria-hidden="true" className="h-4 w-4" />
                ) : (
                  <span>{index + 1}</span>
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
                {step.title}
              </span>
            </Button>
          );
        })}
      </div>

      <BackConfirmDialog
        isNavigating={isNavigating}
        onCancel={() => setPendingBack(null)}
        onConfirm={confirmBack}
        open={!!pendingBack}
        warning={pendingBack?.warning}
      />
    </div>
  );
}

/**
 * StepperControls - Next/Back/Skip buttons
 *
 * Handles forward and backward navigation with server validation.
 * Back navigation shows confirmation dialog and resets server progress.
 */
export function StepperControls({
  stepper,
  onNext,
  onSkip,
  showSkip = false,
  skipLabel = "Skip",
  nextLabel,
  disableNext = false,
  isSubmitting = false,
}: {
  stepper: StepperMethods;
  onNext?: () => void | Promise<void>;
  onSkip?: () => void | Promise<void>;
  showSkip?: boolean;
  skipLabel?: string;
  nextLabel?: string;
  disableNext?: boolean;
  isSubmitting?: boolean;
}) {
  const [isNavigating, setIsNavigating] = useState(false);
  const [pendingBack, setPendingBack] = useState<{
    stepId: StepId;
    warning: string;
  } | null>(null);

  const loading = isSubmitting || isNavigating;

  const handleBack = async () => {
    if (loading || stepper.isFirst) {
      return;
    }

    setIsNavigating(true);
    try {
      const steps = stepper.all;
      const currentIndex = steps.findIndex((s) => s.id === stepper.current.id);
      const targetIndex = currentIndex - 1;
      const targetStepId = steps[targetIndex].id;

      const result = await trpc.onboarding.validateStep.mutate({
        targetStep: (targetIndex + 1) as 1 | 2 | 3 | 4 | 5,
      });

      if (!result.valid) {
        toast.error(result.error || "Cannot go back");
        return;
      }

      if (result.requiresConfirmation && result.warning) {
        setPendingBack({ stepId: targetStepId, warning: result.warning });
        return;
      }

      stepper.goTo(targetStepId);
    } catch {
      toast.error("Failed to validate step");
    } finally {
      setIsNavigating(false);
    }
  };

  const confirmBack = async () => {
    if (!pendingBack) {
      return;
    }

    const store = useOnboardingStore.getState();
    setIsNavigating(true);

    try {
      const steps = stepper.all;
      const targetIndex = steps.findIndex((s) => s.id === pendingBack.stepId);

      await trpc.onboarding.resetToStep.mutate({
        step: (targetIndex + 1) as 1 | 2 | 3 | 4 | 5,
      });

      // Reset downstream flags in store
      if (targetIndex === 0) {
        store.set({
          documentProcessed: false,
          livenessPassed: false,
          faceMatchPassed: false,
          keysSecured: false,
        });
      } else if (targetIndex === 1) {
        store.set({
          livenessPassed: false,
          faceMatchPassed: false,
          keysSecured: false,
        });
      } else {
        store.set({ keysSecured: false });
      }

      stepper.goTo(pendingBack.stepId);
      setPendingBack(null);
    } catch {
      toast.error("Failed to reset progress");
    } finally {
      setIsNavigating(false);
    }
  };

  const handleNext = async () => {
    if (loading) {
      return;
    }
    setIsNavigating(true);

    try {
      if (onNext) {
        await onNext();
      } else {
        // Default: validate with server, then advance
        const steps = stepper.all;
        const currentIndex = steps.findIndex(
          (s) => s.id === stepper.current.id
        );
        const result = await trpc.onboarding.validateStep.mutate({
          targetStep: (currentIndex + 2) as 1 | 2 | 3 | 4 | 5,
        });

        if (!result.valid) {
          toast.error(result.error || "Cannot proceed");
          return;
        }

        stepper.next();
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to proceed");
    } finally {
      setIsNavigating(false);
    }
  };

  const handleSkip = async () => {
    if (loading || !onSkip) {
      return;
    }
    setIsNavigating(true);

    try {
      await onSkip();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to skip");
    } finally {
      setIsNavigating(false);
    }
  };

  const label = nextLabel ?? (stepper.isLast ? "Complete" : "Continue");

  return (
    <>
      <div className="space-y-3 pt-4">
        {/* Primary actions row: Back + Next */}
        <div className="flex items-center justify-between gap-4">
          {/* Back button - only shown when not on first step */}
          {stepper.isFirst ? (
            <div />
          ) : (
            <Button
              disabled={loading}
              onClick={handleBack}
              type="button"
              variant="outline"
            >
              Back
            </Button>
          )}

          {/* Next/Continue/Complete button */}
          <Button
            disabled={disableNext || loading}
            onClick={handleNext}
            type="button"
          >
            {loading ? <Spinner className="mr-2" size="sm" /> : null}
            {label}
          </Button>
        </div>

        {/* Skip button - secondary variant, full width, stacked below */}
        {showSkip && !!onSkip && (
          <Button
            className="w-full"
            disabled={loading}
            onClick={handleSkip}
            type="button"
            variant="secondary"
          >
            {skipLabel}
          </Button>
        )}
      </div>

      <BackConfirmDialog
        isNavigating={isNavigating}
        onCancel={() => setPendingBack(null)}
        onConfirm={confirmBack}
        open={!!pendingBack}
        warning={pendingBack?.warning}
      />
    </>
  );
}

/**
 * BackConfirmDialog - Confirmation dialog for backward navigation
 */
function BackConfirmDialog({
  open,
  warning,
  isNavigating,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  warning?: string;
  isNavigating: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog onOpenChange={(isOpen) => !isOpen && onCancel()} open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Go back to an earlier step?</DialogTitle>
          <DialogDescription>
            {warning || "Going back will reset progress for later steps."}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            disabled={isNavigating}
            onClick={onCancel}
            type="button"
            variant="outline"
          >
            Cancel
          </Button>
          <Button disabled={isNavigating} onClick={onConfirm} type="button">
            {isNavigating ? <Spinner className="mr-2" size="sm" /> : null}
            Go back
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
