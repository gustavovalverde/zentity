import { and, eq } from "drizzle-orm";

import { db } from "../connection";
import {
  type NewRpEncryptionKey,
  type RpEncryptionKey,
  rpEncryptionKeys,
} from "../schema/compliance";

/**
 * Get the active encryption key for an RP client.
 * Returns null if no active key exists.
 */
export async function getActiveRpEncryptionKey(
  clientId: string,
  keyAlgorithm: "x25519" | "x25519-ml-kem" = "x25519"
): Promise<RpEncryptionKey | null> {
  const row = await db
    .select()
    .from(rpEncryptionKeys)
    .where(
      and(
        eq(rpEncryptionKeys.clientId, clientId),
        eq(rpEncryptionKeys.keyAlgorithm, keyAlgorithm),
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
export async function getRpEncryptionKeyById(
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
 * Get all encryption keys for an RP client (including rotated/revoked).
 */
export function getAllRpEncryptionKeys(
  clientId: string
): Promise<RpEncryptionKey[]> {
  return db
    .select()
    .from(rpEncryptionKeys)
    .where(eq(rpEncryptionKeys.clientId, clientId))
    .all();
}

/**
 * Register a new encryption key for an RP.
 * If an active key already exists for this algorithm, this will fail.
 * Use rotateRpEncryptionKey instead for key rotation.
 */
export async function createRpEncryptionKey(
  data: Omit<NewRpEncryptionKey, "createdAt" | "updatedAt">
): Promise<RpEncryptionKey> {
  const keyAlgorithm = data.keyAlgorithm ?? "x25519";
  const existing = await getActiveRpEncryptionKey(data.clientId, keyAlgorithm);
  if (existing) {
    throw new Error(
      "Active encryption key already exists for this client and algorithm"
    );
  }

  const id = data.id ?? crypto.randomUUID();

  await db
    .insert(rpEncryptionKeys)
    .values({
      ...data,
      keyAlgorithm,
      id,
    })
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
  newKeyFingerprint: string,
  keyAlgorithm: "x25519" | "x25519-ml-kem" = "x25519"
): Promise<RpEncryptionKey> {
  const oldKey = await getActiveRpEncryptionKey(clientId, keyAlgorithm);

  // Mark old key as rotated if it exists
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

  // Create new active key
  return createRpEncryptionKey({
    clientId,
    publicKey: newPublicKey,
    keyAlgorithm,
    keyFingerprint: newKeyFingerprint,
    previousKeyId: oldKey?.id ?? null,
    status: "active",
  });
}

/**
 * Revoke an RP's encryption key.
 * This should be called if a key is compromised.
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

/**
 * Delete all encryption keys for an RP.
 * Called when an RP is deleted.
 */
export async function deleteAllRpEncryptionKeys(
  clientId: string
): Promise<void> {
  await db
    .delete(rpEncryptionKeys)
    .where(eq(rpEncryptionKeys.clientId, clientId))
    .run();
}
