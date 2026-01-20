/**
 * Sign-Up Router
 *
 * Manages the progressive account creation wizard (RFC-0017):
 * - Step 1: Email entry (optional)
 * - Step 2: Account creation (passkey/password)
 * - Step 3: Keys secured (final state)
 *
 * Identity verification (document, liveness, face match) happens from the
 * dashboard after account creation, enabling progressive trust levels.
 *
 * State is persisted in an encrypted cookie (stores sessionId) and backed by SQLite.
 */
import "server-only";

import { TRPCError } from "@trpc/server";
import z from "zod";

import {
  consumeFheEnrollmentContext,
  consumeRegistrationBlob,
  createFheEnrollmentContext,
  getFheEnrollmentContext,
} from "@/lib/auth/fhe-enrollment-tokens";
import { linkWalletAddress, updateUserEmail } from "@/lib/db/queries/auth";
import {
  deleteEncryptedSecretByUserAndType,
  getEncryptedSecretByUserAndType,
  updateEncryptedSecretMetadata,
  upsertEncryptedSecret,
  upsertSecretWrapper,
} from "@/lib/db/queries/crypto";
import { upsertIdentityBundle } from "@/lib/db/queries/identity";
import { cleanupExpiredSignUpSessions } from "@/lib/db/queries/sign-up";
import {
  completeSignUp,
  getSessionFromCookie,
  loadWizardState,
  resetToStep,
  type SignUpStep,
  saveWizardState,
  updateWizardProgress,
  validateStepAccess,
} from "@/lib/db/sign-up-session";
import { SECRET_TYPES } from "@/lib/privacy/crypto/secret-types";

import { protectedProcedure, publicProcedure, router } from "../server";

const stepSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);

// Policy constants for identity bundle creation
const ISSUER_ID = "zentity";
const POLICY_VERSION = "1.0";

export const signUpRouter = router({
  /**
   * Retrieves current sign-up session state.
   * Runs cleanup of expired sessions before returning.
   */
  getSession: publicProcedure.query(async () => {
    await cleanupExpiredSignUpSessions();

    const { state, wasCleared } = await loadWizardState();
    if (!state) {
      return { hasSession: false, step: 1, wasCleared };
    }

    return {
      hasSession: true,
      wasCleared: false,
      sessionId: state.sessionId,
      step: state.step,
      keysSecured: state.keysSecured,
    };
  }),

  /**
   * Starts a new sign-up session and advances to account step.
   * If forceNew is true, clears any existing session first.
   */
  startSession: publicProcedure
    .input(z.object({ forceNew: z.boolean().optional() }).optional())
    .mutation(async ({ input, ctx }) => {
      const { state: existingState } = await loadWizardState();
      let sessionId = existingState?.sessionId;

      if (input?.forceNew && sessionId) {
        await completeSignUp(sessionId, ctx.resHeaders);
        sessionId = undefined;
      }

      const session = await saveWizardState(
        sessionId,
        { step: 2 },
        ctx.resHeaders
      );

      return { success: true, sessionId: session.id };
    }),

  /**
   * Marks FHE keys as secured for the current session.
   * Advances to step 3 (keys secured - final state).
   */
  markKeysSecured: publicProcedure.mutation(async ({ ctx }) => {
    // Pass ctx.req for reliable cookie reading in tRPC context
    const session = await getSessionFromCookie(ctx.req);
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
        step: 3,
      },
      ctx.resHeaders
    );

    return { success: true, newStep: 3 };
  }),

  /**
   * Completes sign-up and clears the session.
   * Called when user finishes all steps.
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
      let sessionId = input?.sessionId;

      if (!sessionId) {
        const { state } = await loadWizardState();
        sessionId = state?.sessionId;
      }

      if (!sessionId) {
        return { success: true, cleared: false };
      }

      await completeSignUp(sessionId, ctx.resHeaders);
      return { success: true, cleared: true };
    }),

  /**
   * Validates if user can navigate to a target step.
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

      const targetStep = input.targetStep as SignUpStep;

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

        return {
          valid: true,
          currentStep: session.step,
          error: null,
          warning: null,
          requiresConfirmation: false,
        };
      }

      if (targetStep < session.step) {
        return {
          valid: true,
          currentStep: session.step,
          error: null,
          warning:
            "Going back will reset your progress from this step forward.",
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

      const step = input.step as SignUpStep;
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
   * Creates an enrollment context for FHE key enrollment.
   * Returns tokens needed for secure key registration.
   */
  createContext: protectedProcedure
    .input(z.object({ email: z.email().optional() }).optional())
    .mutation(async ({ input, ctx }) => {
      const email = input?.email?.trim() || null;

      const { contextToken, registrationToken, expiresAt } =
        await createFheEnrollmentContext({
          userId: ctx.userId,
          email,
        });

      return { contextToken, registrationToken, expiresAt };
    }),

  /**
   * Completes FHE key enrollment by storing the wrapped key.
   * Consumes the registration token and persists the encrypted key data.
   *
   * IMPORTANT: This also creates the identity bundle, establishing Tier 1 status.
   * This ensures users who skip document verification still have a valid bundle.
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

      const context = await getFheEnrollmentContext(registration.contextToken);
      if (!context) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "FHE enrollment context expired.",
        });
      }

      if (context.userId !== ctx.userId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "FHE enrollment context does not match session.",
        });
      }

      const secretType = SECRET_TYPES.FHE_KEYS;
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

      // Parallelize independent DB operations
      await Promise.all([
        // Persist email from enrollment context if present
        context.email
          ? updateUserEmail(ctx.userId, context.email)
          : Promise.resolve(),
        // Create identity bundle (Tier 1) - users without doc verification still need one
        upsertIdentityBundle({
          userId: ctx.userId,
          status: "pending",
          fheKeyId: input.keyId,
          fheStatus: "pending",
          issuerId: ISSUER_ID,
          policyVersion: POLICY_VERSION,
        }),
        consumeFheEnrollmentContext(registration.contextToken),
      ]);

      return { success: true, keyId: input.keyId };
    }),

  /**
   * Completes enrollment for OPAQUE (password) users.
   * Creates the identity bundle to establish Tier 1 status.
   *
   * OPAQUE users store FHE keys differently (via storeFheKeysWithCredential),
   * bypassing completeFheEnrollment. This procedure ensures they still get
   * an identity bundle for tier progression.
   */
  completeOpaqueEnrollment: protectedProcedure
    .input(
      z.object({
        fheKeyId: z.string().min(1),
        email: z.email().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await Promise.all([
        input.email
          ? updateUserEmail(ctx.userId, input.email)
          : Promise.resolve(),
        upsertIdentityBundle({
          userId: ctx.userId,
          status: "pending",
          fheKeyId: input.fheKeyId,
          fheStatus: "pending",
          issuerId: ISSUER_ID,
          policyVersion: POLICY_VERSION,
        }),
      ]);
      return { success: true };
    }),

  /**
   * Completes enrollment for wallet (web3) users.
   * Creates the identity bundle to establish Tier 1 status.
   *
   * Wallet users store FHE keys via storeFheKeysWithCredential with wallet
   * signature-derived KEK. This procedure records wallet metadata and creates
   * the identity bundle for tier progression.
   *
   * CRITICAL: Links the wallet address to the user account. Without this,
   * SIWE sign-in would create a new account instead of authenticating to
   * the existing one, making FHE keys inaccessible.
   */
  completeWalletEnrollment: protectedProcedure
    .input(
      z.object({
        fheKeyId: z.string().min(1),
        address: z.string().min(1),
        chainId: z.number().int().positive(),
        email: z.email().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await Promise.all([
        input.email
          ? updateUserEmail(ctx.userId, input.email)
          : Promise.resolve(),
        // Link wallet address for SIWE sign-in
        linkWalletAddress({
          userId: ctx.userId,
          address: input.address,
          chainId: input.chainId,
          isPrimary: true,
        }),
        upsertIdentityBundle({
          userId: ctx.userId,
          status: "pending",
          fheKeyId: input.fheKeyId,
          fheStatus: "pending",
          issuerId: ISSUER_ID,
          policyVersion: POLICY_VERSION,
        }),
      ]);
      return { success: true };
    }),
});
