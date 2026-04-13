import "server-only";

import crypto from "node:crypto";

import { base32 } from "@better-auth/utils/base32";
import { createOTP } from "@better-auth/utils/otp";
import { TRPCError } from "@trpc/server";
import { symmetricDecrypt, symmetricEncrypt } from "better-auth/crypto";
import { z } from "zod";

import { env } from "@/env";
import {
  getEncryptedSecretById,
  listEncryptedSecretsByUserId,
  upsertSecretWrapper,
} from "@/lib/db/queries/privacy";
import {
  completeRecoveryChallenge,
  countRecentRecoveryChallenges,
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
  getRecoveryKeyPin,
  getRecoverySecretWrapperBySecretId,
  getUserByEmail,
  getUserByRecoveryId,
  listApprovalsForChallenge,
  listRecoveryGuardiansByConfigId,
  listRecoveryWrappersByUserId,
  markApprovalUsed,
  markRecoveryChallengeApplied,
  pinRecoveryKey,
  upsertRecoverySecretWrapper,
} from "@/lib/db/queries/recovery";
import {
  getTwoFactorByUserId,
  updateTwoFactorBackupCodes,
} from "@/lib/db/queries/two-factor";
import {
  RECOVERY_GUARDIAN_TYPE_CUSTODIAL_EMAIL,
  RECOVERY_GUARDIAN_TYPE_EMAIL,
  RECOVERY_GUARDIAN_TYPE_TWO_FACTOR,
} from "@/lib/db/schema/recovery";
import {
  sendCustodialRecoveryEmail,
  sendRecoveryGuardianEmails,
} from "@/lib/email/recovery";
import {
  consumeFheEnrollmentContext,
  createFheEnrollmentContext,
  getFheEnrollmentContext,
} from "@/lib/privacy/fhe/enrollment-tokens";
import { wrappedDekSchema } from "@/lib/privacy/secrets/types";
import {
  createRecoveryKeySet,
  executeSigningRounds,
  initSigningSession,
} from "@/lib/recovery/frost-service";
import { signGuardianAssertionJwt } from "@/lib/recovery/guardian-jwt";
import {
  decryptRecoveryWrappedDek,
  deriveFrostUnwrapKey,
  getRecoveryKeyFingerprint,
  getRecoveryPublicKey,
  wrapDekWithFrostKey,
} from "@/lib/recovery/keys";

import { protectedProcedure, publicProcedure, router } from "../server";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const RECOVERY_ID_PREFIX = "rec_";
const TOTP_DIGITS = 6;
const TOTP_PERIOD = 30;
const OTP_CODE_RE = /^\d{6}$/;
const RECOVERY_MESSAGE_PREFIX = "zentity-recovery-intent";
const RECOVERY_MESSAGE_VERSION = "v1";

const ciphersuiteSchema = z.enum(["secp256k1", "ed25519"]).default("secp256k1");

function isExpired(value: string): boolean {
  const date = new Date(value);
  return !Number.isNaN(date.valueOf()) && date < new Date();
}

/**
 * Build the canonical recovery signing intent message. Exposed for the
 * client-side signer and for the verification test suite.
 */
export function buildRecoveryMessage(params: {
  challengeId: string;
  challengeNonce: string;
}): string {
  return [
    RECOVERY_MESSAGE_PREFIX,
    RECOVERY_MESSAGE_VERSION,
    params.challengeId,
    params.challengeNonce,
  ].join(":");
}

function normalizeOtpCode(code: string): string {
  return code.replaceAll(/\s+/g, "");
}

function normalizeRecoveryId(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeBackupCode(code: string): string {
  return code.replaceAll(/[^a-zA-Z0-9]/g, "").toUpperCase();
}

function generateRecoveryId(): string {
  const bytes = crypto.randomBytes(12);
  const encoded = base32.encode(bytes, { padding: false }).toLowerCase();
  return `${RECOVERY_ID_PREFIX}${encoded}`;
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
    key: env.BETTER_AUTH_SECRET,
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
    key: env.BETTER_AUTH_SECRET,
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

// ---------------------------------------------------------------------------
// Config / setup
// ---------------------------------------------------------------------------

const publicKeyProcedure = publicProcedure.query(() => getRecoveryPublicKey());

const configProcedure = protectedProcedure.query(async ({ ctx }) => {
  const config = await getRecoveryConfigByUserId(ctx.userId);
  return { config };
});

const identifierProcedure = protectedProcedure.query(
  async ({ ctx }) => await ensureRecoveryIdentifier(ctx.userId)
);

const setupProcedure = protectedProcedure
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
  });

// ---------------------------------------------------------------------------
// Guardians
// ---------------------------------------------------------------------------

const listGuardiansProcedure = protectedProcedure.query(async ({ ctx }) => {
  const config = await getRecoveryConfigByUserId(ctx.userId);
  if (!config) {
    return { guardians: [] };
  }
  const guardians = await listRecoveryGuardiansByConfigId(config.id);
  return { guardians };
});

const removeGuardianProcedure = protectedProcedure
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
  });

const addGuardianEmailProcedure = protectedProcedure
  .input(z.object({ email: z.email() }))
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
  });

const addGuardianTwoFactorProcedure = protectedProcedure.mutation(
  async ({ ctx }) => {
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
  }
);

const addGuardianCustodialEmailProcedure = protectedProcedure.mutation(
  async ({ ctx }) => {
    const config = await getRecoveryConfigByUserId(ctx.userId);
    if (!config) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Enable recovery before adding guardians.",
      });
    }

    const existing = await getRecoveryGuardianByType({
      recoveryConfigId: config.id,
      guardianType: RECOVERY_GUARDIAN_TYPE_CUSTODIAL_EMAIL,
    });
    if (existing) {
      return { guardian: existing, created: false };
    }

    const guardians = await listRecoveryGuardiansByConfigId(config.id);
    if (guardians.length === 0 && config.totalGuardians === 1) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          "Custodial guardian cannot be the only guardian. Add at least one human guardian first.",
      });
    }

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
      email: ctx.session.user.email ?? "custodial",
      guardianType: RECOVERY_GUARDIAN_TYPE_CUSTODIAL_EMAIL,
      participantIndex,
    });

    return { guardian, created: true };
  }
);

const wrappersStatusProcedure = protectedProcedure.query(async ({ ctx }) => {
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
});

const storeSecretWrapperProcedure = protectedProcedure
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

    const fingerprint = getRecoveryKeyFingerprint();
    const existingPin = await getRecoveryKeyPin(ctx.userId);

    if (existingPin && existingPin.keyFingerprint !== fingerprint) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          "Recovery key has changed since enrollment. This may indicate a key substitution attack.",
      });
    }

    if (!existingPin) {
      await pinRecoveryKey({
        id: crypto.randomUUID(),
        userId: ctx.userId,
        keyFingerprint: fingerprint,
      });
    }

    const wrapper = await upsertRecoverySecretWrapper({
      id: crypto.randomUUID(),
      userId: ctx.userId,
      secretId: secret.id,
      wrappedDek: input.wrappedDek,
      keyId: input.keyId,
    });

    return { stored: true, wrapper };
  });

// ---------------------------------------------------------------------------
// Challenge flow (start, status, approve, recover DEK, finalize)
// ---------------------------------------------------------------------------

const startProcedure = publicProcedure
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

const statusProcedure = publicProcedure
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

const approveGuardianProcedure = publicProcedure
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

      const { sessionId: frostSessionId } = await initSigningSession({
        groupPubkey: config.frostGroupPubkey,
        message,
        participantIds,
      });

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
const recoverDekProcedure = publicProcedure
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
const finalizeProcedure = publicProcedure
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

export const recoveryRouter = router({
  publicKey: publicKeyProcedure,
  config: configProcedure,
  identifier: identifierProcedure,
  setup: setupProcedure,
  listGuardians: listGuardiansProcedure,
  removeGuardian: removeGuardianProcedure,
  addGuardianEmail: addGuardianEmailProcedure,
  addGuardianTwoFactor: addGuardianTwoFactorProcedure,
  addGuardianCustodialEmail: addGuardianCustodialEmailProcedure,
  wrappersStatus: wrappersStatusProcedure,
  storeSecretWrapper: storeSecretWrapperProcedure,
  start: startProcedure,
  status: statusProcedure,
  approveGuardian: approveGuardianProcedure,
  recoverDek: recoverDekProcedure,
  finalize: finalizeProcedure,
});
