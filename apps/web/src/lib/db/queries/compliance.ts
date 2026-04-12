import { and, eq } from "drizzle-orm";

import { db } from "../connection";
import {
  type NewRpEncryptionKey,
  type RpEncryptionKey,
  rpEncryptionKeys,
} from "../schema/oauth-provider";

/**
 * Get the active encryption key for an RP client.
 */
export async function getActiveRpEncryptionKey(
  clientId: string
): Promise<RpEncryptionKey | null> {
  const row = await db
    .select()
    .from(rpEncryptionKeys)
    .where(
      and(
        eq(rpEncryptionKeys.clientId, clientId),
        eq(rpEncryptionKeys.status, "active")
      )
    )
    .limit(1)
    .get();

  return row ?? null;
}

/**
 * Get an encryption key by its ID.
 */
async function getRpEncryptionKeyById(
  id: string
): Promise<RpEncryptionKey | null> {
  const row = await db
    .select()
    .from(rpEncryptionKeys)
    .where(eq(rpEncryptionKeys.id, id))
    .limit(1)
    .get();

  return row ?? null;
}

/**
 * Register a new encryption key for an RP.
 * If an active key already exists, this will fail.
 * Use rotateRpEncryptionKey instead for key rotation.
 */
export async function createRpEncryptionKey(
  data: Omit<NewRpEncryptionKey, "createdAt" | "keyAlgorithm" | "updatedAt">
): Promise<RpEncryptionKey> {
  const existing = await getActiveRpEncryptionKey(data.clientId);
  if (existing) {
    throw new Error("Active encryption key already exists for this client");
  }

  const id = data.id ?? crypto.randomUUID();

  await db
    .insert(rpEncryptionKeys)
    .values({ ...data, id })
    .run();

  const created = await getRpEncryptionKeyById(id);
  if (!created) {
    throw new Error("Failed to create RP encryption key");
  }

  return created;
}

/**
 * Rotate an RP's encryption key.
 * Marks the old key as "rotated" and creates a new active key.
 */
export async function rotateRpEncryptionKey(
  clientId: string,
  newPublicKey: string,
  newKeyFingerprint: string
): Promise<RpEncryptionKey> {
  const oldKey = await getActiveRpEncryptionKey(clientId);

  if (oldKey) {
    await db
      .update(rpEncryptionKeys)
      .set({
        status: "rotated",
        rotatedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(rpEncryptionKeys.id, oldKey.id))
      .run();
  }

  return createRpEncryptionKey({
    clientId,
    publicKey: newPublicKey,
    keyFingerprint: newKeyFingerprint,
    previousKeyId: oldKey?.id ?? null,
    status: "active",
  });
}

/**
 * Revoke an RP's encryption key.
 */
export async function revokeRpEncryptionKey(keyId: string): Promise<void> {
  await db
    .update(rpEncryptionKeys)
    .set({
      status: "revoked",
      updatedAt: new Date().toISOString(),
    })
    .where(eq(rpEncryptionKeys.id, keyId))
    .run();
}
