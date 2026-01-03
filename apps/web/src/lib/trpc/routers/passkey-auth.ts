/**
 * Passkey Authentication Router
 *
 * Handles passkey-first authentication flows:
 * - Registration: Create user + register passkey
 * - Authentication: Verify passkey + create session
 * - Management: List, add, remove, rename passkeys
 */
import "server-only";

import { TRPCError } from "@trpc/server";
import z from "zod";

import {
  createPasskeyChallenge,
  createPasskeySession,
  createPasswordlessUser,
  deletePasskeyCredential,
  getExpectedOrigin,
  getPasskeyCredentialByCredentialId,
  getPasskeyCredentials,
  getRelyingPartyId,
  getUserByEmail,
  registerPasskeyCredential,
  renamePasskeyCredential,
  verifyPasskeyAssertion,
} from "@/lib/auth/passkey-auth";
import {
  consumeRegistrationBlob,
  createRegistrationToken,
} from "@/lib/auth/registration-token";
import { registerFheKey } from "@/lib/crypto/fhe-client";
import {
  deleteEncryptedSecretByUserAndType,
  getEncryptedSecretByUserAndType,
  updateEncryptedSecretMetadata,
  upsertEncryptedSecret,
  upsertSecretWrapper,
} from "@/lib/db/queries/crypto";
import { bytesToBase64Url } from "@/lib/utils/base64url";

import { protectedProcedure, publicProcedure, router } from "../server";

const credentialRegistrationSchema = z.object({
  credentialId: z.string().min(1),
  publicKey: z.string().min(1),
  counter: z.number().int().min(0),
  deviceType: z.enum(["platform", "cross-platform"]).nullable(),
  backedUp: z.boolean(),
  transports: z.array(z.string()),
  name: z.string().optional(),
});

const fheEnrollmentSchema = z.object({
  registrationToken: z.string().min(1),
  wrappedDek: z.string().min(1),
  prfSalt: z.string().min(1),
  credentialId: z.string().min(1),
  publicKey: z.string().min(1),
  serverKey: z.string().min(1),
  version: z.string().min(1),
  kekVersion: z.string().min(1),
});

const assertionSchema = z.object({
  credentialId: z.string().min(1),
  clientDataJSON: z.string().min(1),
  authenticatorData: z.string().min(1),
  signature: z.string().min(1),
  userHandle: z.string().nullable(),
});

export const passkeyAuthRouter = router({
  /**
   * Get registration options for creating a new passkey.
   * Returns challenge, user info, and RP config for WebAuthn API.
   */
  getRegistrationOptions: publicProcedure
    .input(
      z.object({
        email: z.string().email(),
        name: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      // Check if user already exists
      const existingUser = await getUserByEmail(input.email);

      // Generate challenge
      const { challengeId, challenge } = createPasskeyChallenge();

      // If user exists, use their info; otherwise generate new user ID
      const userId = existingUser?.id || crypto.randomUUID();
      const userName = input.name || existingUser?.name || input.email;

      return {
        challengeId,
        challenge: bytesToBase64Url(challenge),
        user: {
          id: userId,
          email: input.email,
          name: userName,
        },
        rp: {
          id: getRelyingPartyId(),
          name: "Zentity",
        },
        origin: getExpectedOrigin(),
        userExists: !!existingUser,
        registrationToken: createRegistrationToken(),
      };
    }),

  /**
   * Complete passkey registration with FHE enrollment.
   * Creates user, stores credential + FHE secret, registers FHE key, returns session.
   */
  completeRegistration: publicProcedure
    .input(
      z.object({
        challengeId: z.string().min(1),
        email: z.string().email(),
        name: z.string().optional(),
        credential: credentialRegistrationSchema,
        fhe: fheEnrollmentSchema,
      })
    )
    .mutation(async ({ input, ctx }) => {
      if (input.fhe.credentialId !== input.credential.credentialId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Passkey credential mismatch.",
        });
      }

      // Check if credential already exists
      const existingCredential = await getPasskeyCredentialByCredentialId(
        input.credential.credentialId
      );
      if (existingCredential) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "This passkey is already registered.",
        });
      }

      // Get or create user
      let user = await getUserByEmail(input.email);
      if (!user) {
        await createPasswordlessUser({
          email: input.email,
          name: input.name || input.email.split("@")[0],
        });
        user = await getUserByEmail(input.email);
        if (!user) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to create user.",
          });
        }
      }

      // Register the passkey credential
      await registerPasskeyCredential({
        userId: user.id,
        credentialId: input.credential.credentialId,
        publicKey: input.credential.publicKey,
        counter: input.credential.counter,
        deviceType: input.credential.deviceType,
        backedUp: input.credential.backedUp,
        transports: input.credential.transports,
        name: input.credential.name,
      });

      const secretType = "fhe_keys";
      let blobMeta: ReturnType<typeof consumeRegistrationBlob>;
      try {
        blobMeta = consumeRegistrationBlob(input.fhe.registrationToken);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error
              ? error.message
              : "Registration token invalid.",
        });
      }
      if (blobMeta.secretType !== secretType) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Registration secret type mismatch.",
        });
      }

      const existingSecret = await getEncryptedSecretByUserAndType(
        user.id,
        secretType
      );
      if (existingSecret && existingSecret.id !== blobMeta.secretId) {
        await deleteEncryptedSecretByUserAndType(user.id, secretType);
      }

      await upsertEncryptedSecret({
        id: blobMeta.secretId,
        userId: user.id,
        secretType,
        encryptedBlob: "",
        blobRef: blobMeta.blobRef,
        blobHash: blobMeta.blobHash,
        blobSize: blobMeta.blobSize,
        metadata: null,
        version: input.fhe.version,
      });

      await upsertSecretWrapper({
        id: crypto.randomUUID(),
        secretId: blobMeta.secretId,
        userId: user.id,
        credentialId: input.fhe.credentialId,
        wrappedDek: input.fhe.wrappedDek,
        prfSalt: input.fhe.prfSalt,
        kekVersion: input.fhe.kekVersion,
      });

      const { keyId } = await registerFheKey({
        serverKey: input.fhe.serverKey,
        publicKey: input.fhe.publicKey,
        requestId: ctx.requestId,
        flowId: ctx.flowId ?? undefined,
      });

      await updateEncryptedSecretMetadata({
        userId: user.id,
        secretType,
        metadata: { keyId },
      });

      // Create session and set cookie via resHeaders
      const { sessionToken, expiresAt } = await createPasskeySession(
        user.id,
        ctx.resHeaders
      );

      return {
        success: true,
        userId: user.id,
        sessionToken,
        expiresAt: expiresAt.toISOString(),
        keyId,
      };
    }),

  /**
   * Get authentication options for signing in with passkey.
   * Returns challenge and optionally filtered credentials.
   */
  getAuthenticationOptions: publicProcedure
    .input(
      z.object({
        email: z.string().email().optional(),
      })
    )
    .query(async ({ input }) => {
      const { challengeId, challenge } = createPasskeyChallenge();

      // If email provided, get user's credentials for allowCredentials
      let allowCredentials: { id: string; transports: string[] }[] | undefined;

      if (input.email) {
        const user = await getUserByEmail(input.email);
        if (user) {
          const credentials = await getPasskeyCredentials(user.id);
          allowCredentials = credentials.map((c) => ({
            id: c.credentialId,
            transports: c.transports
              ? (JSON.parse(c.transports) as string[])
              : [],
          }));
        }
      }

      return {
        challengeId,
        challenge: bytesToBase64Url(challenge),
        allowCredentials,
        rpId: getRelyingPartyId(),
      };
    }),

  /**
   * Verify passkey assertion and create session.
   */
  verifyAuthentication: publicProcedure
    .input(
      z.object({
        challengeId: z.string().min(1),
        assertion: assertionSchema,
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const { userId, credentialId, newCounter } =
          await verifyPasskeyAssertion({
            challengeId: input.challengeId,
            assertion: input.assertion,
          });

        // Create session and set cookie via resHeaders
        const { sessionToken, expiresAt } = await createPasskeySession(
          userId,
          ctx.resHeaders
        );

        return {
          success: true,
          userId,
          credentialId,
          newCounter,
          sessionToken,
          expiresAt: expiresAt.toISOString(),
        };
      } catch (error) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message:
            error instanceof Error
              ? error.message
              : "Passkey verification failed.",
        });
      }
    }),

  /**
   * List all passkeys for the current user.
   */
  listCredentials: protectedProcedure.query(async ({ ctx }) => {
    const credentials = await getPasskeyCredentials(ctx.userId);

    return credentials.map((c) => ({
      id: c.id,
      credentialId: c.credentialId,
      name: c.name,
      deviceType: c.deviceType,
      backedUp: c.backedUp,
      createdAt: c.createdAt,
      lastUsedAt: c.lastUsedAt,
    }));
  }),

  /**
   * Add a new passkey to the current user's account.
   * Used for backup passkeys or multi-device access.
   */
  addCredential: protectedProcedure
    .input(
      z.object({
        challengeId: z.string().min(1),
        credential: credentialRegistrationSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Check if credential already exists
      const existingCredential = await getPasskeyCredentialByCredentialId(
        input.credential.credentialId
      );
      if (existingCredential) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "This passkey is already registered.",
        });
      }

      // Register the passkey credential
      const { id } = await registerPasskeyCredential({
        userId: ctx.userId,
        credentialId: input.credential.credentialId,
        publicKey: input.credential.publicKey,
        counter: input.credential.counter,
        deviceType: input.credential.deviceType,
        backedUp: input.credential.backedUp,
        transports: input.credential.transports,
        name: input.credential.name,
      });

      return { success: true, id };
    }),

  /**
   * Remove a passkey from the current user's account.
   */
  removeCredential: protectedProcedure
    .input(
      z.object({
        credentialId: z.string().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Check if this is the last passkey
      const credentials = await getPasskeyCredentials(ctx.userId);
      if (credentials.length <= 1) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "Cannot remove your only passkey. Add another passkey first or set a password.",
        });
      }

      // Verify the credential belongs to this user
      const credential = await getPasskeyCredentialByCredentialId(
        input.credentialId
      );
      if (!credential || credential.userId !== ctx.userId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Passkey not found.",
        });
      }

      const { deleted } = await deletePasskeyCredential({
        userId: ctx.userId,
        credentialId: input.credentialId,
      });

      return { success: deleted };
    }),

  /**
   * Rename a passkey.
   */
  renameCredential: protectedProcedure
    .input(
      z.object({
        credentialId: z.string().min(1),
        name: z.string().min(1).max(100),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Verify the credential belongs to this user
      const credential = await getPasskeyCredentialByCredentialId(
        input.credentialId
      );
      if (!credential || credential.userId !== ctx.userId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Passkey not found.",
        });
      }

      const { updated } = await renamePasskeyCredential({
        userId: ctx.userId,
        credentialId: input.credentialId,
        name: input.name,
      });

      return { success: updated };
    }),

  /**
   * Get options for adding a new passkey (for authenticated users).
   */
  getAddCredentialOptions: protectedProcedure.query(async ({ ctx }) => {
    const { challengeId, challenge } = createPasskeyChallenge();

    // Get existing credentials to exclude
    const existingCredentials = await getPasskeyCredentials(ctx.userId);

    return {
      challengeId,
      challenge: bytesToBase64Url(challenge),
      user: {
        id: ctx.userId,
        email: ctx.session.user.email,
        name: ctx.session.user.name || ctx.session.user.email,
      },
      rp: {
        id: getRelyingPartyId(),
        name: "Zentity",
      },
      excludeCredentials: existingCredentials.map((c) => ({
        id: c.credentialId,
        transports: c.transports ? (JSON.parse(c.transports) as string[]) : [],
      })),
    };
  }),
});
