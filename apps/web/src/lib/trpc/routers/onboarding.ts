/**
 * Onboarding Router
 *
 * Manages the multi-step onboarding wizard state:
 * - Step 1: Email/password signup
 * - Step 2: Document upload + OCR
 * - Step 3: Liveness detection
 * - Step 4: Review + completion
 *
 * State is persisted in an encrypted cookie and backed by SQLite.
 * Supports forward/backward navigation with prerequisite validation.
 */
import "server-only";

import { TRPCError } from "@trpc/server";
import z from "zod";
import {
  cleanupExpiredOnboardingSessions,
  deleteOnboardingSession,
} from "@/lib/db";
import {
  clearWizardCookie,
  completeOnboarding,
  type EncryptedPiiData,
  getSessionFromCookie,
  loadWizardState,
  type OnboardingStep,
  resetToStep,
  saveWizardState,
  skipLiveness,
  updateWizardProgress,
  validateStepAccess,
} from "@/lib/onboarding-session";
import { publicProcedure, router } from "../server";

const stepSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
]);

const piiSchema = z
  .object({
    extractedName: z.string().optional(),
    extractedDOB: z.string().optional(),
    extractedDocNumber: z.string().optional(),
    extractedNationality: z.string().optional(),
  })
  .partial();

export const onboardingRouter = router({
  /**
   * Retrieves current onboarding session state.
   * Runs cleanup of expired sessions before returning.
   */
  getSession: publicProcedure.query(async () => {
    cleanupExpiredOnboardingSessions();

    const state = await loadWizardState();
    if (!state) {
      return { hasSession: false, step: 1 };
    }

    return {
      hasSession: true,
      email: state.email,
      step: state.step,
      documentProcessed: state.documentProcessed,
      livenessPassed: state.livenessPassed,
      faceMatchPassed: state.faceMatchPassed,
      hasPii: Boolean(state.pii),
      hasExtractedName: Boolean(state.pii?.extractedName),
      hasExtractedDOB: Boolean(state.pii?.extractedDOB),
    };
  }),

  /**
   * Creates or updates an onboarding session.
   * If forceNew is true, clears any existing session first.
   * PII is stored encrypted in the session cookie.
   */
  saveSession: publicProcedure
    .input(
      z.object({
        email: z.string().trim().min(1, "Email is required"),
        step: stepSchema.default(1),
        pii: piiSchema.optional(),
        forceNew: z.boolean().optional(),
        documentProcessed: z.boolean().optional(),
        livenessPassed: z.boolean().optional(),
        faceMatchPassed: z.boolean().optional(),
        documentHash: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      if (input.forceNew) {
        const existingState = await loadWizardState();
        if (existingState) {
          deleteOnboardingSession(existingState.email);
        }
        await clearWizardCookie();
      }

      const updates = {
        documentProcessed: input.documentProcessed,
        livenessPassed: input.livenessPassed,
        faceMatchPassed: input.faceMatchPassed,
        documentHash: input.documentHash,
      };

      if (
        updates.documentProcessed !== undefined ||
        updates.livenessPassed !== undefined ||
        updates.faceMatchPassed !== undefined ||
        updates.documentHash !== undefined
      ) {
        await updateWizardProgress(input.email, {
          step: input.step,
          ...updates,
        });
      } else {
        await saveWizardState(
          { email: input.email, step: input.step ?? 1 },
          input.pii as EncryptedPiiData | undefined,
        );
      }

      return { success: true };
    }),

  /**
   * Completes onboarding and clears the session.
   * Called when user finishes all verification steps.
   */
  clearSession: publicProcedure
    .input(z.object({ email: z.string().trim().min(1).optional() }).optional())
    .mutation(async ({ input }) => {
      const email = input?.email;

      if (!email) {
        const state = await loadWizardState();
        if (state?.email) {
          await completeOnboarding(state.email);
          return { success: true };
        }

        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No session to delete",
        });
      }

      await completeOnboarding(email);
      return { success: true };
    }),

  /**
   * Validates if user can navigate to a target step.
   * Forward navigation requires completing prerequisites.
   * Backward navigation warns about progress reset.
   */
  validateStep: publicProcedure
    .input(z.object({ targetStep: stepSchema }))
    .mutation(async ({ input }) => {
      const session = await getSessionFromCookie();

      if (!session) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "No active session. Please start from the beginning.",
        });
      }

      const targetStep = input.targetStep as OnboardingStep;

      // Going forward - check prerequisites
      if (targetStep > session.step) {
        if (targetStep > session.step + 1) {
          return {
            valid: false,
            currentStep: session.step,
            error: "Complete the current step first",
            warning: null,
            requiresConfirmation: false,
          };
        }

        if (targetStep === 3 && !session.documentProcessed) {
          return {
            valid: false,
            currentStep: session.step,
            error: "Complete document verification first",
            warning: null,
            requiresConfirmation: false,
          };
        }

        if (targetStep === 4 && !session.documentProcessed) {
          return {
            valid: false,
            currentStep: session.step,
            error: "Complete document verification first",
            warning: null,
            requiresConfirmation: false,
          };
        }

        return {
          valid: true,
          currentStep: session.step,
          error: null,
          warning: null,
          requiresConfirmation: false,
        };
      }

      // Going backward - warn about reset
      if (targetStep < session.step) {
        return {
          valid: true,
          currentStep: session.step,
          error: null,
          warning:
            "Going back will reset your progress from this step forward. You will need to redo the following steps.",
          requiresConfirmation: true,
        };
      }

      return {
        valid: true,
        currentStep: session.step,
        error: null,
        warning: null,
        requiresConfirmation: false,
      };
    }),

  /**
   * Resets progress to an earlier step.
   * Clears any progress from the target step forward.
   */
  resetToStep: publicProcedure
    .input(z.object({ step: stepSchema }))
    .mutation(async ({ input }) => {
      const session = await getSessionFromCookie();
      if (!session) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "No active session",
        });
      }

      const step = input.step as OnboardingStep;
      if (step > session.step) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot reset to a future step",
        });
      }

      await resetToStep(session.email, step);
      return { success: true, newStep: step };
    }),

  /**
   * Skips the liveness detection step (for accessibility/fallback).
   * Only allowed when document verification is complete.
   */
  skipLiveness: publicProcedure.mutation(async () => {
    const session = await getSessionFromCookie();
    const validation = validateStepAccess(session, "skip-liveness");
    if (!validation.valid || !validation.session) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: validation.error || "Cannot skip liveness at this time",
      });
    }

    await skipLiveness(validation.session.email);
    return { success: true, newStep: 4 };
  }),
});
