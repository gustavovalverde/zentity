import { and, eq } from "drizzle-orm";

import { db } from "../connection";
import { users } from "../schema/auth";
import {
  type RecoveryConfig,
  type RecoveryGuardian,
  type RecoveryKeyPin,
  type RecoverySecretWrapper,
  recoveryConfigs,
  recoveryGuardians,
  recoveryIdentifiers,
  recoveryKeyPins,
  recoverySecretWrappers,
} from "../schema/recovery";

export async function getUserByRecoveryId(
  recoveryId: string
): Promise<{ id: string; email: string; emailVerified: boolean } | null> {
  const row = await db
    .select({
      id: users.id,
      email: users.email,
      emailVerified: users.emailVerified,
    })
    .from(recoveryIdentifiers)
    .innerJoin(users, eq(users.id, recoveryIdentifiers.userId))
    .where(eq(recoveryIdentifiers.recoveryId, recoveryId))
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

export async function getRecoveryGuardianByType(params: {
  recoveryConfigId: string;
  guardianType: string;
}): Promise<RecoveryGuardian | null> {
  const row = await db
    .select()
    .from(recoveryGuardians)
    .where(
      and(
        eq(recoveryGuardians.recoveryConfigId, params.recoveryConfigId),
        eq(recoveryGuardians.guardianType, params.guardianType)
      )
    )
    .get();

  return row ?? null;
}

export async function deleteRecoveryGuardian(
  guardianId: string
): Promise<void> {
  await db
    .delete(recoveryGuardians)
    .where(eq(recoveryGuardians.id, guardianId))
    .run();
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

export async function getRecoveryKeyPin(
  userId: string
): Promise<RecoveryKeyPin | null> {
  const row = await db
    .select()
    .from(recoveryKeyPins)
    .where(eq(recoveryKeyPins.userId, userId))
    .get();
  return row ?? null;
}

export async function pinRecoveryKey(params: {
  id: string;
  userId: string;
  keyFingerprint: string;
}): Promise<RecoveryKeyPin> {
  await db
    .insert(recoveryKeyPins)
    .values({
      id: params.id,
      userId: params.userId,
      keyFingerprint: params.keyFingerprint,
    })
    .onConflictDoNothing()
    .run();

  const row = await db
    .select()
    .from(recoveryKeyPins)
    .where(eq(recoveryKeyPins.userId, params.userId))
    .get();
  if (!row) {
    throw new Error("Failed to pin recovery key.");
  }
  return row;
}
