import crypto from "node:crypto";

import { and, eq, isNotNull } from "drizzle-orm";

import { db } from "../connection";
import { users } from "../schema/auth";
import {
  type RecoveryChallenge,
  type RecoveryConfig,
  type RecoveryGuardian,
  type RecoveryGuardianApproval,
  type RecoverySecretWrapper,
  recoveryChallenges,
  recoveryConfigs,
  recoveryGuardianApprovals,
  recoveryGuardians,
  recoverySecretWrappers,
} from "../schema/recovery";

export async function getUserByEmail(
  email: string
): Promise<{ id: string; email: string } | null> {
  const row = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.email, email))
    .get();
  return row ?? null;
}

export async function getRecoveryConfigByUserId(
  userId: string
): Promise<RecoveryConfig | null> {
  const row = await db
    .select()
    .from(recoveryConfigs)
    .where(eq(recoveryConfigs.userId, userId))
    .get();
  return row ?? null;
}

export async function getRecoveryConfigById(
  id: string
): Promise<RecoveryConfig | null> {
  const row = await db
    .select()
    .from(recoveryConfigs)
    .where(eq(recoveryConfigs.id, id))
    .get();
  return row ?? null;
}

export async function getRecoveryChallengeById(
  id: string
): Promise<RecoveryChallenge | null> {
  const row = await db
    .select()
    .from(recoveryChallenges)
    .where(eq(recoveryChallenges.id, id))
    .get();
  return row ?? null;
}

export async function listRecoveryGuardiansByConfigId(
  recoveryConfigId: string
): Promise<RecoveryGuardian[]> {
  return await db
    .select()
    .from(recoveryGuardians)
    .where(eq(recoveryGuardians.recoveryConfigId, recoveryConfigId))
    .all();
}

export async function createRecoveryGuardian(params: {
  id: string;
  recoveryConfigId: string;
  email: string;
  participantIndex: number;
  guardianType?: string;
}): Promise<RecoveryGuardian> {
  await db
    .insert(recoveryGuardians)
    .values({
      id: params.id,
      recoveryConfigId: params.recoveryConfigId,
      email: params.email,
      guardianType: params.guardianType ?? "email",
      participantIndex: params.participantIndex,
      status: "active",
    })
    .run();

  const row = await db
    .select()
    .from(recoveryGuardians)
    .where(eq(recoveryGuardians.id, params.id))
    .get();

  if (!row) {
    throw new Error("Failed to create recovery guardian.");
  }

  return row;
}

export async function getRecoveryGuardianByEmail(params: {
  recoveryConfigId: string;
  email: string;
}): Promise<RecoveryGuardian | null> {
  const row = await db
    .select()
    .from(recoveryGuardians)
    .where(
      and(
        eq(recoveryGuardians.recoveryConfigId, params.recoveryConfigId),
        eq(recoveryGuardians.email, params.email)
      )
    )
    .get();

  return row ?? null;
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function createGuardianApprovalToken(params: {
  id: string;
  challengeId: string;
  guardianId: string;
  token: string;
  tokenExpiresAt: string;
}): Promise<RecoveryGuardianApproval> {
  const tokenHash = hashToken(params.token);

  await db
    .insert(recoveryGuardianApprovals)
    .values({
      id: params.id,
      challengeId: params.challengeId,
      guardianId: params.guardianId,
      tokenHash,
      tokenExpiresAt: params.tokenExpiresAt,
    })
    .run();

  const row = await db
    .select()
    .from(recoveryGuardianApprovals)
    .where(eq(recoveryGuardianApprovals.id, params.id))
    .get();

  if (!row) {
    throw new Error("Failed to create guardian approval token.");
  }

  return row;
}

export async function getApprovalByToken(
  token: string
): Promise<(RecoveryGuardianApproval & { guardian: RecoveryGuardian }) | null> {
  const tokenHash = hashToken(token);
  const row = await db
    .select({
      approval: recoveryGuardianApprovals,
      guardian: recoveryGuardians,
    })
    .from(recoveryGuardianApprovals)
    .innerJoin(
      recoveryGuardians,
      eq(recoveryGuardianApprovals.guardianId, recoveryGuardians.id)
    )
    .where(eq(recoveryGuardianApprovals.tokenHash, tokenHash))
    .get();

  if (!row) {
    return null;
  }

  return {
    ...(row.approval as RecoveryGuardianApproval),
    guardian: row.guardian as RecoveryGuardian,
  };
}

export async function markApprovalUsed(params: {
  id: string;
  approvedAt: string;
}): Promise<RecoveryGuardianApproval> {
  await db
    .update(recoveryGuardianApprovals)
    .set({
      approvedAt: params.approvedAt,
    })
    .where(eq(recoveryGuardianApprovals.id, params.id))
    .run();

  const row = await db
    .select()
    .from(recoveryGuardianApprovals)
    .where(eq(recoveryGuardianApprovals.id, params.id))
    .get();

  if (!row) {
    throw new Error("Failed to update guardian approval.");
  }

  return row;
}

export async function countApprovalsForChallenge(
  challengeId: string
): Promise<number> {
  const rows = await db
    .select({ id: recoveryGuardianApprovals.id })
    .from(recoveryGuardianApprovals)
    .where(
      and(
        eq(recoveryGuardianApprovals.challengeId, challengeId),
        isNotNull(recoveryGuardianApprovals.approvedAt)
      )
    )
    .all();

  return rows.length;
}

export async function listApprovalsForChallenge(
  challengeId: string
): Promise<(RecoveryGuardianApproval & { guardian: RecoveryGuardian })[]> {
  const rows = await db
    .select({
      approval: recoveryGuardianApprovals,
      guardian: recoveryGuardians,
    })
    .from(recoveryGuardianApprovals)
    .innerJoin(
      recoveryGuardians,
      eq(recoveryGuardianApprovals.guardianId, recoveryGuardians.id)
    )
    .where(eq(recoveryGuardianApprovals.challengeId, challengeId))
    .all();

  return rows.map((row) => ({
    ...(row.approval as RecoveryGuardianApproval),
    guardian: row.guardian as RecoveryGuardian,
  }));
}

export async function listRecoveryWrappersByUserId(
  userId: string
): Promise<RecoverySecretWrapper[]> {
  return await db
    .select()
    .from(recoverySecretWrappers)
    .where(eq(recoverySecretWrappers.userId, userId))
    .all();
}

export async function createRecoveryConfig(
  data: Omit<RecoveryConfig, "createdAt" | "updatedAt">
): Promise<RecoveryConfig> {
  await db.insert(recoveryConfigs).values(data).run();
  const row = await db
    .select()
    .from(recoveryConfigs)
    .where(eq(recoveryConfigs.id, data.id))
    .get();
  if (!row) {
    throw new Error("Failed to create recovery config.");
  }
  return row;
}

export async function createRecoveryChallenge(
  data: Omit<
    RecoveryChallenge,
    "createdAt" | "completedAt" | "aggregatedSignature" | "signaturesCollected"
  > & {
    signaturesCollected?: number;
    aggregatedSignature?: string | null;
    completedAt?: string | null;
  }
): Promise<RecoveryChallenge> {
  await db
    .insert(recoveryChallenges)
    .values({
      ...data,
      signaturesCollected: data.signaturesCollected ?? 0,
      aggregatedSignature: data.aggregatedSignature ?? null,
      completedAt: data.completedAt ?? null,
    })
    .run();

  const row = await db
    .select()
    .from(recoveryChallenges)
    .where(eq(recoveryChallenges.id, data.id))
    .get();
  if (!row) {
    throw new Error("Failed to create recovery challenge.");
  }
  return row;
}

export async function completeRecoveryChallenge(params: {
  id: string;
  signature: string;
  signaturesCollected: number;
  completedAt: string;
}): Promise<RecoveryChallenge> {
  await db
    .update(recoveryChallenges)
    .set({
      status: "completed",
      aggregatedSignature: params.signature,
      signaturesCollected: params.signaturesCollected,
      completedAt: params.completedAt,
    })
    .where(eq(recoveryChallenges.id, params.id))
    .run();

  const row = await db
    .select()
    .from(recoveryChallenges)
    .where(eq(recoveryChallenges.id, params.id))
    .get();
  if (!row) {
    throw new Error("Failed to load recovery challenge.");
  }
  return row;
}

export async function markRecoveryChallengeApplied(params: {
  id: string;
}): Promise<RecoveryChallenge> {
  await db
    .update(recoveryChallenges)
    .set({
      status: "applied",
    })
    .where(eq(recoveryChallenges.id, params.id))
    .run();

  const row = await db
    .select()
    .from(recoveryChallenges)
    .where(eq(recoveryChallenges.id, params.id))
    .get();
  if (!row) {
    throw new Error("Failed to load recovery challenge.");
  }
  return row;
}

export async function upsertRecoverySecretWrapper(params: {
  id: string;
  userId: string;
  secretId: string;
  wrappedDek: string;
  keyId: string;
}): Promise<RecoverySecretWrapper> {
  await db
    .insert(recoverySecretWrappers)
    .values({
      id: params.id,
      userId: params.userId,
      secretId: params.secretId,
      wrappedDek: params.wrappedDek,
      keyId: params.keyId,
    })
    .onConflictDoUpdate({
      target: recoverySecretWrappers.secretId,
      set: {
        wrappedDek: params.wrappedDek,
        keyId: params.keyId,
        updatedAt: new Date().toISOString(),
      },
    })
    .run();

  const row = await db
    .select()
    .from(recoverySecretWrappers)
    .where(eq(recoverySecretWrappers.secretId, params.secretId))
    .get();
  if (!row) {
    throw new Error("Failed to store recovery wrapper.");
  }
  return row;
}

export async function getRecoverySecretWrapperBySecretId(
  secretId: string
): Promise<RecoverySecretWrapper | null> {
  const row = await db
    .select()
    .from(recoverySecretWrappers)
    .where(eq(recoverySecretWrappers.secretId, secretId))
    .get();
  return row ?? null;
}
