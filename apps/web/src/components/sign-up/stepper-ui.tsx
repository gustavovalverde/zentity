"use client";

import type { Stepper } from "@stepperize/react";

import { Check } from "lucide-react";
import { Fragment, useState } from "react";
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
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils/classname";
import { useSignUpStore } from "@/store/sign-up";

import { type StepId, steps, utils } from "./stepper-config";

/** Stepper instance type inferred from our step definitions */
type SignUpStepper = Stepper<typeof steps>;

/** 1-indexed step number for server validation (RFC-0017: 2-step flow) */
type StepNumber = 1 | 2 | 3;

/**
 * Creates a confirmBack handler for resetting to a previous step.
 * Shared logic between StepperNavigation and StepperControls.
 */
function createConfirmBackHandler({
  getPendingBack,
  setIsNavigating,
  clearPendingBack,
  goToStep,
}: {
  getPendingBack: () => { stepId: StepId; warning: string } | null;
  setIsNavigating: (v: boolean) => void;
  clearPendingBack: () => void;
  goToStep: (stepId: StepId) => void;
}) {
  return async () => {
    const pendingBack = getPendingBack();
    if (!pendingBack) {
      return;
    }

    const store = useSignUpStore.getState();
    setIsNavigating(true);

    try {
      const targetIndex = utils.getIndex(pendingBack.stepId);
      await trpc.signUp.resetToStep.mutate({
        step: (targetIndex + 1) as StepNumber,
      });

      // Reset wizard step in store
      store.set({ wizardStep: (targetIndex + 1) as 1 | 2 | 3 });

      goToStep(pendingBack.stepId);
      clearPendingBack();
    } catch {
      toast.error("Failed to reset progress");
    } finally {
      setIsNavigating(false);
    }
  };
}

/**
 * StepperNavigation - Step indicators following stepperize/shadcn pattern
 *
 * Renders horizontal step indicators with numbered buttons and separators.
 * Completed steps are clickable (with server validation).
 */
export function StepperNavigation({
  stepper,
}: Readonly<{ stepper: SignUpStepper }>) {
  const [isNavigating, setIsNavigating] = useState(false);
  const [pendingBack, setPendingBack] = useState<{
    stepId: StepId;
    warning: string;
  } | null>(null);

  const currentIndex = utils.getIndex(stepper.current.id);

  const handleStepClick = async (stepId: StepId) => {
    const targetIndex = utils.getIndex(stepId);
    if (targetIndex >= currentIndex || isNavigating) {
      return;
    }

    setIsNavigating(true);
    try {
      const result = await trpc.signUp.validateStep.mutate({
        targetStep: (targetIndex + 1) as StepNumber,
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

  const confirmBack = createConfirmBackHandler({
    getPendingBack: () => pendingBack,
    setIsNavigating,
    clearPendingBack: () => setPendingBack(null),
    goToStep: stepper.goTo,
  });

  return (
    <div className="space-y-4">
      {/* Step counter */}
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">
          Step {currentIndex + 1} of {steps.length}
        </span>
        <span className="text-muted-foreground">
          {stepper.current.description}
        </span>
      </div>

      {/* Step indicators - stepperize/shadcn pattern */}
      <nav aria-label="Sign-up Steps">
        <ol className="flex items-center justify-center gap-2">
          {stepper.all.map((step, index, array) => {
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

            return (
              <Fragment key={step.id}>
                <li className="flex shrink-0 items-center gap-2">
                  <Button
                    aria-current={isCurrent ? "step" : undefined}
                    aria-label={`${step.title} - Step ${index + 1}${getStepStatus()}`}
                    className={cn(
                      "flex size-10 items-center justify-center rounded-full transition-all",
                      canNavigate && "cursor-pointer hover:scale-105",
                      isNavigating && "opacity-50"
                    )}
                    disabled={!(canNavigate || isCurrent)}
                    onClick={() => canNavigate && handleStepClick(step.id)}
                    size="icon"
                    type="button"
                    variant={isCompleted || isCurrent ? "default" : "secondary"}
                  >
                    {isCompleted ? (
                      <Check aria-hidden="true" className="size-4" />
                    ) : (
                      <span>{index + 1}</span>
                    )}
                  </Button>
                  <span
                    className={cn(
                      "hidden text-sm sm:block",
                      isCurrent
                        ? "font-medium text-foreground"
                        : "text-muted-foreground"
                    )}
                  >
                    {step.title}
                  </span>
                </li>
                {index < array.length - 1 && (
                  <Separator
                    className={cn(
                      "w-12! transition-colors sm:w-20!",
                      index < currentIndex ? "bg-primary" : "bg-muted"
                    )}
                  />
                )}
              </Fragment>
            );
          })}
        </ol>
      </nav>

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
 * StepperControls - Navigation buttons following stepperize/shadcn pattern
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
  hideBack = false,
}: Readonly<{
  stepper: SignUpStepper;
  onNext?: () => void | Promise<void>;
  onSkip?: () => void | Promise<void>;
  showSkip?: boolean;
  skipLabel?: string;
  nextLabel?: string;
  disableNext?: boolean;
  isSubmitting?: boolean;
  hideBack?: boolean;
}>) {
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
      const currentIndex = utils.getIndex(stepper.current.id);
      const targetIndex = currentIndex - 1;
      const targetStepId = steps[targetIndex].id;

      const result = await trpc.signUp.validateStep.mutate({
        targetStep: (targetIndex + 1) as StepNumber,
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

  const confirmBack = createConfirmBackHandler({
    getPendingBack: () => pendingBack,
    setIsNavigating,
    clearPendingBack: () => setPendingBack(null),
    goToStep: stepper.goTo,
  });

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
        const currentIndex = utils.getIndex(stepper.current.id);
        const result = await trpc.signUp.validateStep.mutate({
          targetStep: (currentIndex + 2) as StepNumber,
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
      {/* Controls - stepperize/shadcn pattern */}
      <div className="flex flex-col gap-3 pt-4">
        {/* Primary actions */}
        {stepper.isFirst ? (
          /* First step: full-width primary button */
          <Button
            className="w-full"
            disabled={disableNext || loading}
            onClick={handleNext}
            type="button"
          >
            {loading ? <Spinner className="mr-2" size="sm" /> : null}
            {label}
          </Button>
        ) : (
          /* Subsequent steps: Back + Next side by side (unless hideBack) */
          <div className="flex justify-end gap-4">
            {!hideBack && (
              <Button
                disabled={loading}
                onClick={handleBack}
                type="button"
                variant="secondary"
              >
                Back
              </Button>
            )}
            <Button
              disabled={disableNext || loading}
              onClick={handleNext}
              type="button"
            >
              {loading ? <Spinner className="mr-2" size="sm" /> : null}
              {label}
            </Button>
          </div>
        )}

        {/* Skip button - secondary, full width */}
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
}: Readonly<{
  open: boolean;
  warning?: string;
  isNavigating: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}>) {
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
