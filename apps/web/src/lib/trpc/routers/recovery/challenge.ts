import crypto from "node:crypto";

import { TRPCError } from "@trpc/server";
import { symmetricEncrypt } from "better-auth/crypto";
import { z } from "zod";

import {
  consumeOnboardingContext,
  createOnboardingContext,
  getOnboardingContext,
} from "@/lib/auth/onboarding-tokens";
import {
  listEncryptedSecretsByUserId,
  upsertSecretWrapper,
} from "@/lib/db/queries/crypto";
import {
  completeRecoveryChallenge,
  countRecentRecoveryChallenges,
  createGuardianApprovalToken,
  createRecoveryChallenge,
  getApprovalByToken,
  getRecoveryChallengeById,
  getRecoveryConfigById,
  getRecoveryConfigByUserId,
  getRecoverySecretWrapperBySecretId,
  getUserByEmail,
  getUserByRecoveryId,
  listApprovalsForChallenge,
  listRecoveryGuardiansByConfigId,
  markApprovalUsed,
  markRecoveryChallengeApplied,
} from "@/lib/db/queries/recovery";
import {
  getTwoFactorByUserId,
  updateTwoFactorBackupCodes,
} from "@/lib/db/queries/two-factor";
import { sendRecoveryGuardianEmails } from "@/lib/email/recovery-mailer";
import {
  OPAQUE_CREDENTIAL_ID,
  RECOVERY_WRAP_VERSION,
  wrapDekWithOpaqueExportServer,
  wrapDekWithPrfServer,
} from "@/lib/privacy/crypto/passkey-wrap.server";
import {
  RECOVERY_GUARDIAN_TYPE_EMAIL,
  RECOVERY_GUARDIAN_TYPE_TWO_FACTOR,
} from "@/lib/recovery/constants";
import { signRecoveryChallenge } from "@/lib/recovery/frost-service";
import { decryptRecoveryWrappedDek } from "@/lib/recovery/recovery-keys";
import { base64ToBytes } from "@/lib/utils/base64";
import { getBetterAuthSecret } from "@/lib/utils/env";

import { publicProcedure } from "../../server";
import {
  buildRecoveryMessage,
  isExpired,
  normalizeRecoveryId,
  verifyTwoFactorGuardianCode,
} from "./verification";

export const startProcedure = publicProcedure
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

    const recentAttempts = await countRecentRecoveryChallenges(user.id, 24);
    if (recentAttempts >= 3) {
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message:
          "Too many recovery attempts. Please wait 24 hours before trying again.",
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
  });

export const statusProcedure = publicProcedure
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
    const approvedCount = approvals.filter((entry) => entry.approvedAt).length;
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
  });

export const approveGuardianProcedure = publicProcedure
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

    if (approval.guardian.guardianType === RECOVERY_GUARDIAN_TYPE_TWO_FACTOR) {
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

    if (challenge.status === "pending" && approvalsCount >= config.threshold) {
      const sortedApproved = approved
        .toSorted((a, b) => {
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
  });

export const finalizeProcedure = publicProcedure
  .input(
    z
      .object({
        challengeId: z.string().min(1),
        contextToken: z.string().min(1),
        credentialType: z.enum(["passkey", "opaque"]),
        credentialId: z.string().min(1).optional(),
        prfSalt: z.string().min(1).optional(),
        prfOutput: z.string().min(1).optional(),
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

    const isPasskey = input.credentialType === "passkey";
    const prfOutput = isPasskey ? base64ToBytes(input.prfOutput ?? "") : null;
    const exportKey = isPasskey ? null : base64ToBytes(input.exportKey ?? "");

    const inputCredentialId = input.credentialId;
    const inputPrfSalt = input.prfSalt;
    const hasValidPrfCredential =
      isPasskey && prfOutput && inputCredentialId && inputPrfSalt;
    const hasValidOpaqueCredential = !isPasskey && exportKey;

    if (!(hasValidPrfCredential || hasValidOpaqueCredential)) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Invalid credential data for re-wrapping.",
      });
    }

    const rewrapResults = await Promise.all(
      secrets.map(async (secret) => {
        const recoveryWrapper = await getRecoverySecretWrapperBySecretId(
          secret.id
        );
        if (!recoveryWrapper) {
          return false;
        }

        const dek = decryptRecoveryWrappedDek({
          wrappedDek: recoveryWrapper.wrappedDek,
          keyId: recoveryWrapper.keyId,
        });

        let wrappedDek: string;
        let credentialId: string;
        let prfSalt: string;
        let kekSource: "prf" | "opaque" | "recovery";

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
        } else if (exportKey) {
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
          return false;
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

        return true;
      })
    );

    const rewrappedCount = rewrapResults.filter(Boolean).length;

    await markRecoveryChallengeApplied({ id: challenge.id });
    await consumeOnboardingContext(input.contextToken);

    return { rewrappedCount };
  });
