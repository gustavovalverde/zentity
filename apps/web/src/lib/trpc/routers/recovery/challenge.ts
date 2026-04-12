import crypto from "node:crypto";

import { TRPCError } from "@trpc/server";
import { symmetricEncrypt } from "better-auth/crypto";
import { z } from "zod";

import { env } from "@/env";
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
  getRecoveryKeyPin,
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
import {
  sendCustodialRecoveryEmail,
  sendRecoveryGuardianEmails,
} from "@/lib/email/recovery-mailer";
import {
  consumeFheEnrollmentContext,
  createFheEnrollmentContext,
  getFheEnrollmentContext,
} from "@/lib/privacy/fhe/fhe-enrollment-tokens";
import { wrappedDekSchema } from "@/lib/privacy/secrets/types";
import {
  RECOVERY_GUARDIAN_TYPE_CUSTODIAL_EMAIL,
  RECOVERY_GUARDIAN_TYPE_EMAIL,
  RECOVERY_GUARDIAN_TYPE_TWO_FACTOR,
} from "@/lib/recovery/constants";
import {
  executeSigningRounds,
  initSigningSession,
} from "@/lib/recovery/frost-service";
import { signGuardianAssertionJwt } from "@/lib/recovery/guardian-jwt";
import {
  decryptRecoveryWrappedDek,
  deriveFrostUnwrapKey,
  getRecoveryKeyFingerprint,
  wrapDekWithFrostKey,
} from "@/lib/recovery/recovery-keys";

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

    const custodialApproval = approvalTokens.find(
      (approval) =>
        approval.guardianType === RECOVERY_GUARDIAN_TYPE_CUSTODIAL_EMAIL
    );

    const [delivery] = await Promise.all([
      sendRecoveryGuardianEmails({
        accountEmail: user.email,
        approvals: emailApprovals.map((approval) => ({
          email: approval.email,
          token: approval.token,
        })),
      }),
      custodialApproval && user.emailVerified
        ? sendCustodialRecoveryEmail({
            email: custodialApproval.email,
            token: custodialApproval.token,
          })
        : Promise.resolve(false),
    ]);

    const enrollment = await createFheEnrollmentContext({
      userId: user.id,
      email: user.email,
    });

    return {
      challengeId: challenge.id,
      contextToken: enrollment.contextToken,
      expiresAt: enrollment.expiresAt,
      approvals: approvalTokens,
      threshold: config.threshold,
      delivery: delivery.mode,
      deliveredCount: delivery.delivered + (custodialApproval ? 1 : 0),
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
      aggregatedSignature: challenge.aggregatedSignature,
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
          key: env.BETTER_AUTH_SECRET,
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

      // Step 1: Initialize FROST signing session (creates session ID)
      const { sessionId: frostSessionId } = await initSigningSession({
        groupPubkey: config.frostGroupPubkey,
        message,
        participantIds,
      });

      // Step 2: Mint guardian JWTs with the FROST session ID
      const guardianAssertions = new Map<number, string>();
      for (const entry of sortedApproved) {
        const jwt = await signGuardianAssertionJwt({
          frostSessionId,
          challengeId: challenge.id,
          guardianId: entry.guardian.id,
          participantIndex: entry.guardian.participantIndex,
          userId: challenge.userId,
        });
        guardianAssertions.set(entry.guardian.participantIndex, jwt);
      }

      // Include custodial signer endpoint if configured
      let endpointOverrides: Map<number, string> | undefined;
      if (env.CUSTODIAL_SIGNER_URL) {
        const custodialGuardian = sortedApproved.find(
          (a) =>
            a.guardian.guardianType === RECOVERY_GUARDIAN_TYPE_CUSTODIAL_EMAIL
        );
        if (custodialGuardian) {
          endpointOverrides = new Map([
            [
              custodialGuardian.guardian.participantIndex,
              env.CUSTODIAL_SIGNER_URL,
            ],
          ]);
        }
      }

      // Step 3: Execute signing rounds with guardian assertions
      const { signature, signaturesCollected } = await executeSigningRounds({
        sessionId: frostSessionId,
        groupPubkey: config.frostGroupPubkey,
        ciphersuite: config.frostCiphersuite as "secp256k1" | "ed25519",
        message,
        participantIds,
        totalParticipants: config.totalGuardians,
        guardianAssertions,
        endpointOverrides,
      });

      const frostKey = deriveFrostUnwrapKey({
        signatureHex: signature,
        challengeId: challenge.id,
      });

      const secrets = await listEncryptedSecretsByUserId(challenge.userId);
      const wrappedEntries: { secretId: string; wrapped: string }[] = [];

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
          secretId: secret.id,
          userId: challenge.userId,
        });
        wrappedEntries.push({
          secretId: secret.id,
          wrapped: wrapDekWithFrostKey(dek, frostKey),
        });
      }

      const completedAt = new Date().toISOString();
      await completeRecoveryChallenge({
        id: challenge.id,
        signature,
        signaturesCollected,
        completedAt,
        frostWrappedDeks: JSON.stringify(wrappedEntries),
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

/**
 * Step 1: Server releases FROST-wrapped DEKs for recovery.
 * DEKs are encrypted under a key derived from the FROST aggregated signature
 * via HKDF. The client must have the real signature to derive the unwrap key.
 * This prevents DB status manipulation from releasing plaintext DEKs.
 */
export const recoverDekProcedure = publicProcedure
  .input(
    z.object({
      challengeId: z.string().min(1),
      contextToken: z.string().min(1),
    })
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

    if (!(challenge.aggregatedSignature && challenge.frostWrappedDeks)) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          "Recovery challenge is missing FROST signature or wrapped DEKs.",
      });
    }

    const context = await getFheEnrollmentContext(input.contextToken);
    if (!context || context.userId !== challenge.userId) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Recovery context is invalid.",
      });
    }

    const pin = await getRecoveryKeyPin(challenge.userId);
    if (pin) {
      const currentFingerprint = getRecoveryKeyFingerprint();
      if (pin.keyFingerprint !== currentFingerprint) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "Recovery key fingerprint mismatch. The key may have been substituted since enrollment.",
        });
      }
    }

    const frostWrappedDeks: { secretId: string; wrapped: string }[] =
      JSON.parse(challenge.frostWrappedDeks);

    return {
      userId: challenge.userId,
      aggregatedSignature: challenge.aggregatedSignature,
      deks: frostWrappedDeks.map((entry) => ({
        secretId: entry.secretId,
        frostWrappedDek: entry.wrapped,
      })),
    };
  });

/**
 * Step 2: Client stores pre-wrapped DEKs after client-side re-wrapping.
 * Credential material (PRF output, export key) never touches the server.
 */
export const finalizeProcedure = publicProcedure
  .input(
    z.object({
      challengeId: z.string().min(1),
      contextToken: z.string().min(1),
      wrappers: z.array(
        z.object({
          secretId: z.string().min(1),
          credentialId: z.string().min(1),
          wrappedDek: wrappedDekSchema,
          prfSalt: z.string().optional(),
          kekSource: z.enum(["prf", "opaque", "wallet"]),
        })
      ),
    })
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

    const context = await getFheEnrollmentContext(input.contextToken);
    if (!context || context.userId !== challenge.userId) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Recovery context is invalid.",
      });
    }

    for (const wrapper of input.wrappers) {
      await upsertSecretWrapper({
        id: crypto.randomUUID(),
        secretId: wrapper.secretId,
        userId: challenge.userId,
        credentialId: wrapper.credentialId,
        wrappedDek: wrapper.wrappedDek,
        prfSalt: wrapper.prfSalt ?? "",
        kekSource: wrapper.kekSource,
      });
    }

    await markRecoveryChallengeApplied({ id: challenge.id });
    await consumeFheEnrollmentContext(input.contextToken);

    return { rewrappedCount: input.wrappers.length };
  });
