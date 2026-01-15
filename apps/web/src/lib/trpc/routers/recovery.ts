import "server-only";

import crypto from "node:crypto";

import { base32 } from "@better-auth/utils/base32";
import { createOTP } from "@better-auth/utils/otp";
import { TRPCError } from "@trpc/server";
import { symmetricDecrypt, symmetricEncrypt } from "better-auth/crypto";
import { z } from "zod";

import {
  consumeOnboardingContext,
  createOnboardingContext,
  getOnboardingContext,
} from "@/lib/auth/onboarding-context";
import {
  OPAQUE_CREDENTIAL_ID,
  RECOVERY_WRAP_VERSION,
  wrapDekWithOpaqueExportServer,
  wrapDekWithPrfServer,
} from "@/lib/crypto/passkey-wrap.server";
import {
  getEncryptedSecretById,
  listEncryptedSecretsByUserId,
  upsertSecretWrapper,
} from "@/lib/db/queries/crypto";
import {
  completeRecoveryChallenge,
  createGuardianApprovalToken,
  createRecoveryChallenge,
  createRecoveryConfig,
  createRecoveryGuardian,
  createRecoveryIdentifier,
  deleteRecoveryGuardian,
  getApprovalByToken,
  getRecoveryChallengeById,
  getRecoveryConfigById,
  getRecoveryConfigByUserId,
  getRecoveryGuardianByEmail,
  getRecoveryGuardianById,
  getRecoveryGuardianByType,
  getRecoveryIdentifierByUserId,
  getRecoveryIdentifierByValue,
  getRecoverySecretWrapperBySecretId,
  getUserByEmail,
  getUserByRecoveryId,
  listApprovalsForChallenge,
  listRecoveryGuardiansByConfigId,
  listRecoveryWrappersByUserId,
  markApprovalUsed,
  markRecoveryChallengeApplied,
  upsertRecoverySecretWrapper,
} from "@/lib/db/queries/recovery";
import {
  getTwoFactorByUserId,
  updateTwoFactorBackupCodes,
} from "@/lib/db/queries/two-factor";
import { sendRecoveryGuardianEmails } from "@/lib/email/recovery-mailer";
import {
  RECOVERY_GUARDIAN_TYPE_EMAIL,
  RECOVERY_GUARDIAN_TYPE_TWO_FACTOR,
} from "@/lib/recovery/constants";
import {
  createRecoveryKeySet,
  signRecoveryChallenge,
} from "@/lib/recovery/frost-service";
import {
  decryptRecoveryWrappedDek,
  getRecoveryPublicKey,
} from "@/lib/recovery/recovery-keys";
import { base64ToBytes } from "@/lib/utils/base64";
import { getBetterAuthSecret } from "@/lib/utils/env";

import { protectedProcedure, publicProcedure, router } from "../server";

const ciphersuiteSchema = z.enum(["secp256k1", "ed25519"]).default("secp256k1");
const RECOVERY_ID_PREFIX = "rec_";
const TOTP_DIGITS = 6;
const TOTP_PERIOD = 30;
const OTP_CODE_RE = /^\d{6}$/;

function isExpired(value: string): boolean {
  const date = new Date(value);
  return !Number.isNaN(date.valueOf()) && date < new Date();
}

function buildRecoveryMessage(params: {
  challengeId: string;
  challengeNonce: string;
}): string {
  return `recovery:${params.challengeId}:${params.challengeNonce}`;
}

function normalizeOtpCode(code: string): string {
  return code.replace(/\s+/g, "");
}

function normalizeRecoveryId(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeBackupCode(code: string): string {
  return code.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
}

function generateRecoveryId(): string {
  const bytes = crypto.randomBytes(12);
  const encoded = base32.encode(bytes, { padding: false }).toLowerCase();
  return `${RECOVERY_ID_PREFIX}${encoded}`;
}

async function ensureRecoveryIdentifier(
  userId: string
): Promise<{ recoveryId: string; createdAt: string }> {
  const existing = await getRecoveryIdentifierByUserId(userId);
  if (existing) {
    return { recoveryId: existing.recoveryId, createdAt: existing.createdAt };
  }

  let recoveryId = generateRecoveryId();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const collision = await getRecoveryIdentifierByValue(recoveryId);
    if (!collision) {
      break;
    }
    recoveryId = generateRecoveryId();
  }

  const created = await createRecoveryIdentifier({
    id: crypto.randomUUID(),
    userId,
    recoveryId,
  });

  return { recoveryId: created.recoveryId, createdAt: created.createdAt };
}

async function verifyTwoFactorGuardianCode(params: {
  userId: string;
  code: string;
}): Promise<{ method: "backup" | "totp"; updatedCodes?: string[] } | null> {
  const twoFactor = await getTwoFactorByUserId(params.userId);
  if (!twoFactor) {
    return null;
  }

  const normalized = normalizeBackupCode(params.code);
  if (!normalized) {
    return null;
  }

  const decryptedSecret = await symmetricDecrypt({
    key: getBetterAuthSecret(),
    data: twoFactor.secret,
  });
  const otp = createOTP(decryptedSecret, {
    digits: TOTP_DIGITS,
    period: TOTP_PERIOD,
  });
  const code = normalizeOtpCode(params.code);
  if (code && OTP_CODE_RE.test(code)) {
    const valid = await otp.verify(code);
    if (valid) {
      return { method: "totp" };
    }
  }

  const decryptedBackup = await symmetricDecrypt({
    key: getBetterAuthSecret(),
    data: twoFactor.backupCodes,
  });
  let backupCodes: string[] = [];
  try {
    const parsed = JSON.parse(decryptedBackup);
    if (Array.isArray(parsed)) {
      backupCodes = parsed;
    }
  } catch {
    return null;
  }

  const matchIndex = backupCodes.findIndex(
    (entry) => normalizeBackupCode(entry) === normalized
  );
  if (matchIndex === -1) {
    return null;
  }

  const updatedCodes = backupCodes.filter((_, index) => index !== matchIndex);
  return { method: "backup", updatedCodes };
}

export const recoveryRouter = router({
  publicKey: publicProcedure.query(() => {
    return getRecoveryPublicKey();
  }),

  config: protectedProcedure.query(async ({ ctx }) => {
    const config = await getRecoveryConfigByUserId(ctx.userId);
    return { config };
  }),

  identifier: protectedProcedure.query(
    async ({ ctx }) => await ensureRecoveryIdentifier(ctx.userId)
  ),

  setup: protectedProcedure
    .input(
      z.object({
        threshold: z.number().int().min(2).max(5).optional(),
        totalGuardians: z.number().int().min(2).max(5).optional(),
        ciphersuite: ciphersuiteSchema.optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await getRecoveryConfigByUserId(ctx.userId);
      if (existing) {
        return { config: existing, created: false };
      }

      const keySet = await createRecoveryKeySet({
        threshold: input.threshold,
        totalGuardians: input.totalGuardians,
        ciphersuite: input.ciphersuite,
      });

      const config = await createRecoveryConfig({
        id: crypto.randomUUID(),
        userId: ctx.userId,
        threshold: keySet.threshold,
        totalGuardians: keySet.totalGuardians,
        frostGroupPubkey: keySet.groupPubkey,
        frostPublicKeyPackage: keySet.publicKeyPackage,
        frostCiphersuite: keySet.ciphersuite,
        status: "active",
      });

      return { config, created: true };
    }),

  listGuardians: protectedProcedure.query(async ({ ctx }) => {
    const config = await getRecoveryConfigByUserId(ctx.userId);
    if (!config) {
      return { guardians: [] };
    }
    const guardians = await listRecoveryGuardiansByConfigId(config.id);
    return { guardians };
  }),

  removeGuardian: protectedProcedure
    .input(z.object({ guardianId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const config = await getRecoveryConfigByUserId(ctx.userId);
      if (!config) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Enable recovery before managing guardians.",
        });
      }

      const guardian = await getRecoveryGuardianById(input.guardianId);
      if (!guardian || guardian.recoveryConfigId !== config.id) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Guardian not found.",
        });
      }

      await deleteRecoveryGuardian(guardian.id);
      return { guardianId: guardian.id, guardianType: guardian.guardianType };
    }),

  addGuardianEmail: protectedProcedure
    .input(z.object({ email: z.string().email() }))
    .mutation(async ({ ctx, input }) => {
      const config = await getRecoveryConfigByUserId(ctx.userId);
      if (!config) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Enable recovery before adding guardians.",
        });
      }

      const normalizedEmail = input.email.trim().toLowerCase();
      const existing = await getRecoveryGuardianByEmail({
        recoveryConfigId: config.id,
        email: normalizedEmail,
      });
      if (existing) {
        return { guardian: existing, created: false };
      }

      const guardians = await listRecoveryGuardiansByConfigId(config.id);
      if (guardians.length >= config.totalGuardians) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "All guardian slots are already filled.",
        });
      }

      const assignedIndices = new Set(guardians.map((g) => g.participantIndex));
      let participantIndex = 1;
      while (
        participantIndex <= config.totalGuardians &&
        assignedIndices.has(participantIndex)
      ) {
        participantIndex += 1;
      }

      if (participantIndex > config.totalGuardians) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No guardian slots available.",
        });
      }

      const guardian = await createRecoveryGuardian({
        id: crypto.randomUUID(),
        recoveryConfigId: config.id,
        email: normalizedEmail,
        participantIndex,
      });

      return { guardian, created: true };
    }),

  addGuardianTwoFactor: protectedProcedure.mutation(async ({ ctx }) => {
    const config = await getRecoveryConfigByUserId(ctx.userId);
    if (!config) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Enable recovery before adding guardians.",
      });
    }

    const existing = await getRecoveryGuardianByType({
      recoveryConfigId: config.id,
      guardianType: RECOVERY_GUARDIAN_TYPE_TWO_FACTOR,
    });
    if (existing) {
      return { guardian: existing, created: false };
    }

    const twoFactor = await getTwoFactorByUserId(ctx.userId);
    if (!twoFactor) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Enable two-factor authentication before linking a guardian.",
      });
    }

    const guardians = await listRecoveryGuardiansByConfigId(config.id);
    if (guardians.length >= config.totalGuardians) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "All guardian slots are already filled.",
      });
    }

    const assignedIndices = new Set(guardians.map((g) => g.participantIndex));
    let participantIndex = 1;
    while (
      participantIndex <= config.totalGuardians &&
      assignedIndices.has(participantIndex)
    ) {
      participantIndex += 1;
    }

    if (participantIndex > config.totalGuardians) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "No guardian slots available.",
      });
    }

    const guardian = await createRecoveryGuardian({
      id: crypto.randomUUID(),
      recoveryConfigId: config.id,
      email: "authenticator",
      guardianType: RECOVERY_GUARDIAN_TYPE_TWO_FACTOR,
      participantIndex,
    });

    return { guardian, created: true };
  }),

  wrappersStatus: protectedProcedure.query(async ({ ctx }) => {
    const secrets = await listEncryptedSecretsByUserId(ctx.userId);
    const wrappers = await listRecoveryWrappersByUserId(ctx.userId);
    const wrappedIds = new Set(wrappers.map((wrapper) => wrapper.secretId));

    const entries = secrets.map((secret) => ({
      secretId: secret.id,
      secretType: secret.secretType,
      hasWrapper: wrappedIds.has(secret.id),
    }));

    const wrappedCount = entries.filter((entry) => entry.hasWrapper).length;

    return {
      totalSecrets: entries.length,
      wrappedCount,
      secrets: entries,
    };
  }),

  storeSecretWrapper: protectedProcedure
    .input(
      z.object({
        secretId: z.string().min(1),
        wrappedDek: z.string().min(1),
        keyId: z.string().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const secret = await getEncryptedSecretById(ctx.userId, input.secretId);
      if (!secret) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Secret not found for user.",
        });
      }

      const config = await getRecoveryConfigByUserId(ctx.userId);
      if (!config) {
        return { stored: false };
      }

      const wrapper = await upsertRecoverySecretWrapper({
        id: crypto.randomUUID(),
        userId: ctx.userId,
        secretId: secret.id,
        wrappedDek: input.wrappedDek,
        keyId: input.keyId,
      });

      return { stored: true, wrapper };
    }),

  start: publicProcedure
    .input(z.object({ identifier: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const normalized = normalizeRecoveryId(input.identifier);
      const user = normalized.includes("@")
        ? await getUserByEmail(normalized)
        : await getUserByRecoveryId(normalized);
      if (!user) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "No account found for that email or recovery ID.",
        });
      }

      const config = await getRecoveryConfigByUserId(user.id);
      if (!config) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Recovery is not enabled for this account.",
        });
      }

      const now = new Date();
      const expiresAt = new Date(now.getTime() + 15 * 60 * 1000);

      const challenge = await createRecoveryChallenge({
        id: crypto.randomUUID(),
        userId: user.id,
        recoveryConfigId: config.id,
        challengeNonce: crypto.randomUUID(),
        status: "pending",
        expiresAt: expiresAt.toISOString(),
      });

      const guardians = await listRecoveryGuardiansByConfigId(config.id);
      if (guardians.length < config.threshold) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Not enough guardians configured for recovery.",
        });
      }

      if (
        guardians.some(
          (guardian) =>
            guardian.guardianType === RECOVERY_GUARDIAN_TYPE_TWO_FACTOR
        )
      ) {
        const twoFactor = await getTwoFactorByUserId(user.id);
        if (!twoFactor) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              "Authenticator guardian is not configured. Enable two-factor authentication and link it again.",
          });
        }
      }

      const approvalTokens = await Promise.all(
        guardians.map(async (guardian) => {
          const token = crypto.randomUUID();
          const approval = await createGuardianApprovalToken({
            id: crypto.randomUUID(),
            challengeId: challenge.id,
            guardianId: guardian.id,
            token,
            tokenExpiresAt: expiresAt.toISOString(),
          });

          return {
            guardianId: guardian.id,
            email: guardian.email,
            guardianType: guardian.guardianType,
            token,
            tokenExpiresAt: approval.tokenExpiresAt,
          };
        })
      );

      const emailApprovals = approvalTokens.filter(
        (approval) => approval.guardianType === RECOVERY_GUARDIAN_TYPE_EMAIL
      );

      const delivery = await sendRecoveryGuardianEmails({
        accountEmail: user.email,
        approvals: emailApprovals.map((approval) => ({
          email: approval.email,
          token: approval.token,
        })),
      });

      const onboarding = await createOnboardingContext({
        userId: user.id,
        email: user.email,
      });

      return {
        challengeId: challenge.id,
        contextToken: onboarding.contextToken,
        expiresAt: onboarding.expiresAt,
        approvals: approvalTokens,
        threshold: config.threshold,
        delivery: delivery.mode,
        deliveredCount: delivery.delivered,
      };
    }),

  status: publicProcedure
    .input(z.object({ challengeId: z.string().min(1) }))
    .query(async ({ input }) => {
      const challenge = await getRecoveryChallengeById(input.challengeId);
      if (!challenge) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Recovery challenge not found.",
        });
      }

      const config = await getRecoveryConfigById(challenge.recoveryConfigId);
      if (!config) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Recovery configuration not found.",
        });
      }

      const approvals = await listApprovalsForChallenge(challenge.id);
      const approvedCount = approvals.filter(
        (entry) => entry.approvedAt
      ).length;
      return {
        status: challenge.status,
        approvals: approvedCount,
        guardianApprovals: approvals.map((entry) => ({
          guardianId: entry.guardian.id,
          guardianType: entry.guardian.guardianType,
          approvedAt: entry.approvedAt,
        })),
        threshold: config.threshold,
        expiresAt: challenge.expiresAt,
        completedAt: challenge.completedAt,
      };
    }),

  approveGuardian: publicProcedure
    .input(z.object({ token: z.string().min(1), code: z.string().optional() }))
    .mutation(async ({ input }) => {
      const approval = await getApprovalByToken(input.token);
      if (!approval) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Approval token not found.",
        });
      }

      if (isExpired(approval.tokenExpiresAt)) {
        throw new TRPCError({
          code: "TIMEOUT",
          message: "Approval token has expired.",
        });
      }

      if (approval.guardian.status !== "active") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Guardian is not active.",
        });
      }

      const challenge = await getRecoveryChallengeById(approval.challengeId);
      if (!challenge) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Recovery challenge not found.",
        });
      }

      if (isExpired(challenge.expiresAt)) {
        throw new TRPCError({
          code: "TIMEOUT",
          message: "Recovery challenge has expired.",
        });
      }

      const config = await getRecoveryConfigById(challenge.recoveryConfigId);
      if (!config) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Recovery configuration not found.",
        });
      }

      if (
        approval.guardian.guardianType === RECOVERY_GUARDIAN_TYPE_TWO_FACTOR
      ) {
        const code = input.code ?? "";
        if (!code.trim()) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "An authenticator or backup code is required.",
          });
        }

        const verification = await verifyTwoFactorGuardianCode({
          userId: config.userId,
          code,
        });
        if (!verification) {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Invalid authenticator or backup code.",
          });
        }

        if (verification.method === "backup" && verification.updatedCodes) {
          const encryptedBackupCodes = await symmetricEncrypt({
            key: getBetterAuthSecret(),
            data: JSON.stringify(verification.updatedCodes),
          });
          await updateTwoFactorBackupCodes({
            userId: config.userId,
            backupCodes: encryptedBackupCodes,
          });
        }
      }

      if (!approval.approvedAt) {
        await markApprovalUsed({
          id: approval.id,
          approvedAt: new Date().toISOString(),
        });
      }

      const approvals = await listApprovalsForChallenge(challenge.id);
      const approved = approvals.filter((entry) => entry.approvedAt);
      const approvalsCount = approved.length;

      if (
        challenge.status === "pending" &&
        approvalsCount >= config.threshold
      ) {
        const sortedApproved = approved
          .sort((a, b) => {
            const timeA = new Date(a.approvedAt ?? 0).getTime();
            const timeB = new Date(b.approvedAt ?? 0).getTime();
            return timeA - timeB;
          })
          .slice(0, config.threshold);

        const participantIds = sortedApproved.map(
          (entry) => entry.guardian.participantIndex
        );

        if (participantIds.length < config.threshold) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Not enough guardian approvals to sign.",
          });
        }

        const message = buildRecoveryMessage({
          challengeId: challenge.id,
          challengeNonce: challenge.challengeNonce,
        });

        const { signature, signaturesCollected } = await signRecoveryChallenge({
          groupPubkey: config.frostGroupPubkey,
          ciphersuite: config.frostCiphersuite as "secp256k1" | "ed25519",
          threshold: config.threshold,
          message,
          participantIds,
          totalParticipants: config.totalGuardians,
        });

        const completedAt = new Date().toISOString();
        await completeRecoveryChallenge({
          id: challenge.id,
          signature,
          signaturesCollected,
          completedAt,
        });

        return {
          status: "completed",
          approvals: approvalsCount,
          threshold: config.threshold,
          signaturesCollected,
        };
      }

      return {
        status: challenge.status,
        approvals: approvalsCount,
        threshold: config.threshold,
      };
    }),

  finalize: publicProcedure
    .input(
      z
        .object({
          challengeId: z.string().min(1),
          contextToken: z.string().min(1),
          credentialType: z.enum(["passkey", "opaque"]),
          // Passkey fields
          credentialId: z.string().min(1).optional(),
          prfSalt: z.string().min(1).optional(),
          prfOutput: z.string().min(1).optional(),
          // OPAQUE fields
          exportKey: z.string().min(1).optional(),
        })
        .refine(
          (data) => {
            if (data.credentialType === "passkey") {
              return data.credentialId && data.prfSalt && data.prfOutput;
            }
            return data.exportKey;
          },
          {
            message:
              "Passkey requires credentialId, prfSalt, and prfOutput. OPAQUE requires exportKey.",
          }
        )
    )
    .mutation(async ({ input }) => {
      const challenge = await getRecoveryChallengeById(input.challengeId);
      if (!challenge) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Recovery challenge not found.",
        });
      }

      if (challenge.status !== "completed") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Recovery challenge is not approved.",
        });
      }

      if (isExpired(challenge.expiresAt)) {
        throw new TRPCError({
          code: "TIMEOUT",
          message: "Recovery challenge has expired.",
        });
      }

      const context = await getOnboardingContext(input.contextToken);
      if (!context || context.userId !== challenge.userId) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Recovery context is invalid.",
        });
      }

      const secrets = await listEncryptedSecretsByUserId(challenge.userId);

      // Parse credential-specific data
      const isPasskey = input.credentialType === "passkey";
      const prfOutput = isPasskey ? base64ToBytes(input.prfOutput ?? "") : null;
      const exportKey = isPasskey ? null : base64ToBytes(input.exportKey ?? "");

      let rewrappedCount = 0;
      for (const secret of secrets) {
        const recoveryWrapper = await getRecoverySecretWrapperBySecretId(
          secret.id
        );
        if (!recoveryWrapper) {
          continue;
        }

        const dek = decryptRecoveryWrappedDek({
          wrappedDek: recoveryWrapper.wrappedDek,
          keyId: recoveryWrapper.keyId,
        });

        let wrappedDek: string;
        let credentialId: string;
        let prfSalt: string;
        let kekSource: "prf" | "opaque" | "recovery";

        // Extract credential values for type narrowing
        const inputCredentialId = input.credentialId;
        const inputPrfSalt = input.prfSalt;

        // Named conditions for readability (reduces cognitive load)
        const hasValidPrfCredential =
          isPasskey && prfOutput && inputCredentialId && inputPrfSalt;
        const hasValidOpaqueCredential = !isPasskey && exportKey;

        if (hasValidPrfCredential) {
          wrappedDek = await wrapDekWithPrfServer({
            secretId: secret.id,
            credentialId: inputCredentialId,
            dek,
            prfOutput,
          });
          credentialId = inputCredentialId;
          prfSalt = inputPrfSalt;
          kekSource = "prf";
        } else if (hasValidOpaqueCredential) {
          wrappedDek = await wrapDekWithOpaqueExportServer({
            secretId: secret.id,
            userId: challenge.userId,
            dek,
            exportKey,
          });
          credentialId = OPAQUE_CREDENTIAL_ID;
          prfSalt = "";
          kekSource = "opaque";
        } else {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Invalid credential data for re-wrapping.",
          });
        }

        await upsertSecretWrapper({
          id: crypto.randomUUID(),
          secretId: secret.id,
          userId: challenge.userId,
          credentialId,
          wrappedDek,
          prfSalt,
          kekVersion: RECOVERY_WRAP_VERSION,
          kekSource,
        });

        rewrappedCount += 1;
      }

      await markRecoveryChallengeApplied({ id: challenge.id });
      await consumeOnboardingContext(input.contextToken);

      return { rewrappedCount };
    }),
});
