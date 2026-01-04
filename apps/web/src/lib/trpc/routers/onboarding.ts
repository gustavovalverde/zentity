/**
 * Onboarding Router
 *
 * Manages the multi-step onboarding wizard state:
 * - Step 1: Email entry
 * - Step 2: Document upload + OCR
 * - Step 3: Liveness detection
 * - Step 4: Review + create account
 * - Step 5: Secure keys (passkey-protected FHE keys)
 *
 * State is persisted in an encrypted cookie (stores sessionId) and backed by SQLite.
 * Sessions are keyed by sessionId, not email, to prevent state leakage between users.
 */
import "server-only";

import { TRPCError } from "@trpc/server";
import z from "zod";

import {
  completeOnboarding,
  getSessionFromCookie,
  loadWizardState,
  type OnboardingStep,
  resetToStep,
  saveWizardState,
  skipLiveness,
  updateWizardProgress,
  validateStepAccess,
} from "@/lib/db/onboarding-session";
import { cleanupExpiredOnboardingSessions } from "@/lib/db/queries/onboarding";

import { publicProcedure, router } from "../server";

const stepSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
]);

export const onboardingRouter = router({
  /**
   * Retrieves current onboarding session state.
   * Runs cleanup of expired sessions before returning.
   *
   * Returns `wasCleared: true` if a stale cookie was just cleared,
   * allowing the client to show a notification to the user.
   */
  getSession: publicProcedure.query(async () => {
    await cleanupExpiredOnboardingSessions();

    const { state, wasCleared } = await loadWizardState();
    if (!state) {
      return { hasSession: false, step: 1, wasCleared };
    }

    return {
      hasSession: true,
      wasCleared: false,
      sessionId: state.sessionId,
      step: state.step,
      identityDraftId: state.identityDraftId ?? null,
      documentProcessed: state.documentProcessed,
      livenessPassed: state.livenessPassed,
      faceMatchPassed: state.faceMatchPassed,
      keysSecured: state.keysSecured,
    };
  }),

  /**
   * Creates or updates an onboarding session.
   * If forceNew is true, clears any existing session first.
   * PII is stored encrypted in the session.
   *
   * Returns the sessionId for client tracking.
   */
  saveSession: publicProcedure
    .input(
      z.object({
        step: stepSchema.default(1),
        forceNew: z.boolean().optional(),
        documentProcessed: z.boolean().optional(),
        livenessPassed: z.boolean().optional(),
        faceMatchPassed: z.boolean().optional(),
        keysSecured: z.boolean().optional(),
        documentHash: z.string().optional(),
        identityDraftId: z.string().optional().nullable(),
      })
    )
    .mutation(async ({ input }) => {
      // Get existing session from cookie (if any)
      const { state: existingState } = await loadWizardState();
      let sessionId = existingState?.sessionId;

      // If forceNew, clear existing session and create new one
      if (input.forceNew) {
        if (sessionId) {
          await completeOnboarding(sessionId);
        }
        sessionId = undefined; // Will generate new sessionId
      }

      const updates = {
        documentProcessed: input.documentProcessed,
        livenessPassed: input.livenessPassed,
        faceMatchPassed: input.faceMatchPassed,
        keysSecured: input.keysSecured,
        documentHash: input.documentHash,
        identityDraftId: input.identityDraftId ?? undefined,
      };

      const hasUpdates =
        updates.documentProcessed !== undefined ||
        updates.livenessPassed !== undefined ||
        updates.faceMatchPassed !== undefined ||
        updates.keysSecured !== undefined ||
        updates.documentHash !== undefined ||
        updates.identityDraftId !== undefined;

      if (hasUpdates && sessionId) {
        // Update existing session
        await updateWizardProgress(sessionId, {
          step: input.step,
          ...updates,
        });
        return { success: true, sessionId };
      }

      // Create new session or update basic fields
      const session = await saveWizardState(sessionId, {
        step: input.step ?? 1,
      });

      return { success: true, sessionId: session.id };
    }),

  /**
   * Completes onboarding and clears the session.
   * Called when user finishes all verification steps.
   */
  clearSession: publicProcedure
    .input(
      z
        .object({
          sessionId: z.string().optional(),
        })
        .optional()
    )
    .mutation(async ({ input }) => {
      // Try to get sessionId from input or from cookie
      let sessionId = input?.sessionId;

      if (!sessionId) {
        const { state } = await loadWizardState();
        sessionId = state?.sessionId;
      }

      if (!sessionId) {
        // Idempotent no-op: the client may call this defensively during "start over"
        // flows even when no session cookie exists.
        return { success: true, cleared: false };
      }

      await completeOnboarding(sessionId);
      return { success: true, cleared: true };
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

        if (targetStep === 5 && !session.documentProcessed) {
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

      await resetToStep(session.id, step);
      return { success: true, newStep: step };
    }),

  /**
   * Skips the liveness detection step (for accessibility/fallback).
   * Only allowed when document verification is complete.
   */
  skipLiveness: publicProcedure.mutation(async () => {
    const session = await getSessionFromCookie();
    const validation = validateStepAccess(session, "skip-liveness");
    if (!(validation.valid && validation.session)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: validation.error || "Cannot skip liveness at this time",
      });
    }

    await skipLiveness(validation.session.id);
    return { success: true, newStep: 4 };
  }),
});
