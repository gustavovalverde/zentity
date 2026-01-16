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
  consumeOnboardingContext,
  consumeRegistrationBlob,
  createOnboardingContext,
  getOnboardingContext,
} from "@/lib/auth/onboarding-context";
import {
  completeOnboarding,
  getSessionFromCookie,
  loadWizardState,
  type OnboardingStep,
  resetToStep,
  saveWizardState,
  updateWizardProgress,
  validateStepAccess,
} from "@/lib/db/onboarding-session";
import {
  deleteEncryptedSecretByUserAndType,
  getEncryptedSecretByUserAndType,
  updateEncryptedSecretMetadata,
  upsertEncryptedSecret,
  upsertSecretWrapper,
} from "@/lib/db/queries/crypto";
import { cleanupExpiredOnboardingSessions } from "@/lib/db/queries/onboarding";

import { protectedProcedure, publicProcedure, router } from "../server";

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
   * Starts a new onboarding session.
   * If forceNew is true, clears any existing session first.
   */
  startSession: publicProcedure
    .input(z.object({ forceNew: z.boolean().optional() }).optional())
    .mutation(async ({ input, ctx }) => {
      const { state: existingState } = await loadWizardState();
      let sessionId = existingState?.sessionId;

      if (input?.forceNew && sessionId) {
        await completeOnboarding(sessionId, ctx.resHeaders);
        sessionId = undefined;
      }

      const session = await saveWizardState(
        sessionId,
        { step: 1 },
        ctx.resHeaders
      );

      return { success: true, sessionId: session.id };
    }),

  /**
   * Marks FHE keys as secured for the current session.
   * Advances to step 5 (secure keys complete).
   */
  markKeysSecured: publicProcedure.mutation(async ({ ctx }) => {
    const session = await getSessionFromCookie();
    const validation = validateStepAccess(session, "secure-keys");
    if (!(validation.valid && validation.session)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: validation.error || "Complete previous steps first",
      });
    }

    await updateWizardProgress(
      validation.session.id,
      {
        keysSecured: true,
        step: 5,
      },
      ctx.resHeaders
    );

    return { success: true, newStep: 5 };
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
    .mutation(async ({ input, ctx }) => {
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

      await completeOnboarding(sessionId, ctx.resHeaders);
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
    .mutation(async ({ input, ctx }) => {
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

      await resetToStep(session.id, step, ctx.resHeaders);
      return { success: true, newStep: step };
    }),

  /**
   * Creates an onboarding context for FHE key enrollment.
   * Returns tokens needed for secure key registration.
   */
  createContext: protectedProcedure
    .input(z.object({ email: z.string().email().optional() }).optional())
    .mutation(async ({ input, ctx }) => {
      const email = input?.email?.trim() || null;

      const { contextToken, registrationToken, expiresAt } =
        await createOnboardingContext({
          userId: ctx.userId,
          email,
        });

      return { contextToken, registrationToken, expiresAt };
    }),

  /**
   * Completes FHE key enrollment by storing the wrapped key.
   * Consumes the registration token and persists the encrypted key data.
   */
  completeFheEnrollment: protectedProcedure
    .input(
      z.object({
        registrationToken: z.string().min(1),
        wrappedDek: z.string().min(1),
        prfSalt: z.string().min(1),
        credentialId: z.string().min(1),
        keyId: z.string().min(1),
        version: z.string().min(1),
        kekVersion: z.string().min(1),
        envelopeFormat: z.enum(["json", "msgpack"]),
      })
    )
    .mutation(async ({ input, ctx }) => {
      if (input.envelopeFormat !== "msgpack") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Unsupported FHE envelope format.",
        });
      }

      let registration: Awaited<ReturnType<typeof consumeRegistrationBlob>>;
      try {
        registration = await consumeRegistrationBlob(input.registrationToken);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error
              ? error.message
              : "Registration token invalid.",
        });
      }

      const context = await getOnboardingContext(registration.contextToken);
      if (!context) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Onboarding context expired.",
        });
      }

      if (context.userId !== ctx.userId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Onboarding context does not match session.",
        });
      }

      const secretType = "fhe_keys";
      if (registration.blob.secretType !== secretType) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Registration secret type mismatch.",
        });
      }

      const existingSecret = await getEncryptedSecretByUserAndType(
        ctx.userId,
        secretType
      );
      if (
        existingSecret &&
        existingSecret.id !== registration.blob.secretId &&
        existingSecret.userId === ctx.userId
      ) {
        await deleteEncryptedSecretByUserAndType(ctx.userId, secretType);
      }

      await upsertEncryptedSecret({
        id: registration.blob.secretId,
        userId: ctx.userId,
        secretType,
        encryptedBlob: "",
        blobRef: registration.blob.blobRef,
        blobHash: registration.blob.blobHash,
        blobSize: registration.blob.blobSize,
        metadata: { envelopeFormat: input.envelopeFormat },
        version: input.version,
      });

      await upsertSecretWrapper({
        id: crypto.randomUUID(),
        secretId: registration.blob.secretId,
        userId: ctx.userId,
        credentialId: input.credentialId,
        wrappedDek: input.wrappedDek,
        prfSalt: input.prfSalt,
        kekVersion: input.kekVersion,
      });

      await updateEncryptedSecretMetadata({
        userId: ctx.userId,
        secretType,
        metadata: {
          envelopeFormat: input.envelopeFormat,
          keyId: input.keyId,
        },
      });

      await consumeOnboardingContext(registration.contextToken);

      return { success: true, keyId: input.keyId };
    }),
});
