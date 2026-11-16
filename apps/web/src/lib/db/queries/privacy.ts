import type {
  CredentialBindingCommitmentRecord,
  EncryptedSecretRecord,
  NewEncryptedAttribute,
  NewProofArtifact,
  NewProofSession,
  ProofSessionRecord,
  SecretWrapperRecord,
  SignedClaimRecord,
} from "../schema/privacy";

import crypto from "node:crypto";

import { constantTimeEqual } from "better-auth/crypto";
import { and, desc, eq, isNull } from "drizzle-orm";

import { getCiphertextHmacKey } from "@/lib/privacy/primitives/derived-keys";
import { encodeAad } from "@/lib/privacy/primitives/symmetric";

import { type DbExecutor, db } from "../connection";
import { isoTimestampNow } from "../schema/auth";
import {
  credentialBindingCommitments,
  encryptedAttributes,
  encryptedSecrets,
  proofArtifacts,
  proofSessions,
  secretWrappers,
  signedClaims,
} from "../schema/privacy";

function computeCiphertextHash(
  ciphertext: Buffer,
  userId: string,
  attributeType: string
): string {
  const context = encodeAad([userId, attributeType]);
  return crypto
    .createHmac("sha256", getCiphertextHmacKey())
    .update(context)
    .update(ciphertext)
    .digest("hex");
}

function ensureCiphertextIntegrity(params: {
  ciphertext: Buffer;
  ciphertextHash: string | null;
  userId: string;
  attributeType: string;
}): string {
  const computed = computeCiphertextHash(
    params.ciphertext,
    params.userId,
    params.attributeType
  );
  const stored = params.ciphertextHash ?? "";

  if (!stored) {
    return computed;
  }

  if (!constantTimeEqual(stored, computed)) {
    throw new Error(
      `Encrypted attribute integrity check failed for ${params.attributeType}:${params.userId}`
    );
  }

  return stored;
}

export async function getEncryptedSecretByUserAndType(
  userId: string,
  secretType: string
): Promise<EncryptedSecretRecord | null> {
  const row = await db
    .select()
    .from(encryptedSecrets)
    .where(
      and(
        eq(encryptedSecrets.userId, userId),
        eq(encryptedSecrets.secretType, secretType)
      )
    )
    .limit(1)
    .get();

  return row ?? null;
}

export async function getEncryptedSecretById(
  userId: string,
  secretId: string
): Promise<EncryptedSecretRecord | null> {
  const row = await db
    .select()
    .from(encryptedSecrets)
    .where(
      and(
        eq(encryptedSecrets.userId, userId),
        eq(encryptedSecrets.id, secretId)
      )
    )
    .limit(1)
    .get();

  return row ?? null;
}

/** Whether any account stores a secret under this id. */
export async function isSecretIdStored(secretId: string): Promise<boolean> {
  const row = await db
    .select({ id: encryptedSecrets.id })
    .from(encryptedSecrets)
    .where(eq(encryptedSecrets.id, secretId))
    .limit(1)
    .get();
  return Boolean(row);
}

export async function getSecretWrappersBySecretId(
  secretId: string
): Promise<SecretWrapperRecord[]> {
  return await db
    .select()
    .from(secretWrappers)
    .where(eq(secretWrappers.secretId, secretId))
    .all();
}

export async function updateEncryptedSecretMetadata(data: {
  userId: string;
  secretType: string;
  metadata: Record<string, unknown> | null;
}): Promise<EncryptedSecretRecord | null> {
  const row = await db
    .update(encryptedSecrets)
    .set({
      metadata: data.metadata,
    })
    .where(
      and(
        eq(encryptedSecrets.userId, data.userId),
        eq(encryptedSecrets.secretType, data.secretType)
      )
    )
    .returning()
    .get();

  return row ?? null;
}

export async function upsertSecretWrapper(data: {
  secretId: string;
  userId: string;
  credentialId: string;
  wrappedDek: string;
  prfSalt?: string | null | undefined;
  kekSource?: string | undefined;
  verifierHash?: string | null | undefined;
}): Promise<SecretWrapperRecord> {
  const kekSource = data.kekSource ?? "prf";
  const verifierHash = data.verifierHash ?? null;

  const row = await db
    .insert(secretWrappers)
    .values({
      secretId: data.secretId,
      userId: data.userId,
      credentialId: data.credentialId,
      wrappedDek: data.wrappedDek,
      prfSalt: data.prfSalt ?? null,
      kekSource,
      verifierHash,
    })
    .onConflictDoUpdate({
      target: [secretWrappers.secretId, secretWrappers.credentialId],
      set: {
        wrappedDek: data.wrappedDek,
        prfSalt: data.prfSalt ?? null,
        kekSource,
        verifierHash,
      },
    })
    .returning()
    .get();
  if (!row) {
    throw new Error("Failed to upsert secret wrapper");
  }
  return row;
}

/**
 * Stop a credential from unlocking the vault: delete its wrappers and revoke
 * the identity-binding commitment derived from it.
 */
export async function detachVaultCredential(
  userId: string,
  credentialId: string
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .delete(secretWrappers)
      .where(
        and(
          eq(secretWrappers.userId, userId),
          eq(secretWrappers.credentialId, credentialId)
        )
      )
      .run();
    await tx
      .update(credentialBindingCommitments)
      .set({ revokedAt: isoTimestampNow })
      .where(
        and(
          eq(credentialBindingCommitments.userId, userId),
          eq(credentialBindingCommitments.credentialId, credentialId),
          isNull(credentialBindingCommitments.revokedAt)
        )
      )
      .run();
  });
}

/**
 * Delete every vault secret of a user with its wrappers and binding
 * commitments. Returns the deleted secret ids so their blobs can be removed.
 */
export function deleteVaultSecrets(
  userId: string,
  executor: Pick<typeof db, "transaction"> = db
): Promise<string[]> {
  return executor.transaction(async (tx) => {
    await tx
      .delete(credentialBindingCommitments)
      .where(eq(credentialBindingCommitments.userId, userId))
      .run();
    await tx
      .delete(secretWrappers)
      .where(eq(secretWrappers.userId, userId))
      .run();
    const rows = await tx
      .delete(encryptedSecrets)
      .where(eq(encryptedSecrets.userId, userId))
      .returning({ id: encryptedSecrets.id });
    return rows.map((row) => row.id);
  });
}

export async function createProofSession(
  data: NewProofSession,
  executor: DbExecutor = db
): Promise<void> {
  await executor.insert(proofSessions).values(data).run();
}

export async function getProofSessionById(
  id: string
): Promise<ProofSessionRecord | null> {
  const row = await db
    .select()
    .from(proofSessions)
    .where(eq(proofSessions.id, id))
    .limit(1)
    .get();
  return row ?? null;
}

export async function closeProofSession(
  id: string,
  executor: DbExecutor = db
): Promise<void> {
  await executor
    .update(proofSessions)
    .set({
      closedAt: Date.now(),
    })
    .where(eq(proofSessions.id, id))
    .run();
}

export async function getProofTypesByUserAndVerification(
  userId: string,
  verificationId: string
): Promise<string[]> {
  const rows = await db
    .select({ proofType: proofArtifacts.proofType })
    .from(proofArtifacts)
    .where(
      and(
        eq(proofArtifacts.userId, userId),
        eq(proofArtifacts.verificationId, verificationId),
        eq(proofArtifacts.verified, true)
      )
    )
    .groupBy(proofArtifacts.proofType)
    .orderBy(proofArtifacts.proofType)
    .all();

  return rows.map((row) => row.proofType);
}

export async function getProofTypesByUserVerificationAndSession(
  userId: string,
  verificationId: string,
  proofSessionId: string,
  executor: DbExecutor = db
): Promise<string[]> {
  const rows = await executor
    .select({ proofType: proofArtifacts.proofType })
    .from(proofArtifacts)
    .where(
      and(
        eq(proofArtifacts.userId, userId),
        eq(proofArtifacts.verificationId, verificationId),
        eq(proofArtifacts.proofSessionId, proofSessionId),
        eq(proofArtifacts.verified, true)
      )
    )
    .groupBy(proofArtifacts.proofType)
    .orderBy(proofArtifacts.proofType)
    .all();

  return rows.map((row) => row.proofType);
}

export async function getEncryptedAttributeTypesByUserId(
  userId: string
): Promise<string[]> {
  const rows = await db
    .select({ attributeType: encryptedAttributes.attributeType })
    .from(encryptedAttributes)
    .where(eq(encryptedAttributes.userId, userId))
    .groupBy(encryptedAttributes.attributeType)
    .orderBy(encryptedAttributes.attributeType)
    .all();

  return rows.map((row) => row.attributeType);
}

export async function getLatestEncryptedAttributeByUserAndType(
  userId: string,
  attributeType: string
): Promise<{
  ciphertext: Buffer;
  ciphertextHash: string;
  keyId: string | null;
  encryptionTimeMs: number | null;
  createdAt: string;
} | null> {
  const row = await db
    .select({
      ciphertext: encryptedAttributes.ciphertext,
      ciphertextHash: encryptedAttributes.ciphertextHash,
      keyId: encryptedAttributes.keyId,
      encryptionTimeMs: encryptedAttributes.encryptionTimeMs,
      createdAt: encryptedAttributes.createdAt,
    })
    .from(encryptedAttributes)
    .where(
      and(
        eq(encryptedAttributes.userId, userId),
        eq(encryptedAttributes.attributeType, attributeType)
      )
    )
    .orderBy(desc(encryptedAttributes.createdAt))
    .limit(1)
    .get();

  if (!row) {
    return null;
  }

  const ciphertextHash = ensureCiphertextIntegrity({
    ciphertext: row.ciphertext,
    ciphertextHash: row.ciphertextHash,
    userId,
    attributeType,
  });

  return {
    ciphertext: row.ciphertext,
    ciphertextHash,
    keyId: row.keyId,
    encryptionTimeMs: row.encryptionTimeMs,
    createdAt: row.createdAt,
  };
}

export async function getSignedClaimTypesByUserAndVerification(
  userId: string,
  verificationId: string
): Promise<string[]> {
  const rows = await db
    .select({ claimType: signedClaims.claimType })
    .from(signedClaims)
    .where(
      and(
        eq(signedClaims.userId, userId),
        eq(signedClaims.verificationId, verificationId)
      )
    )
    .groupBy(signedClaims.claimType)
    .orderBy(signedClaims.claimType)
    .all();

  return rows.map((row) => row.claimType);
}

export async function getProofHashesByUserVerificationAndSession(
  userId: string,
  verificationId: string,
  proofSessionId: string,
  executor: DbExecutor = db
): Promise<string[]> {
  const rows = await executor
    .select({ proofHash: proofArtifacts.proofHash })
    .from(proofArtifacts)
    .where(
      and(
        eq(proofArtifacts.userId, userId),
        eq(proofArtifacts.verificationId, verificationId),
        eq(proofArtifacts.proofSessionId, proofSessionId),
        eq(proofArtifacts.verified, true)
      )
    )
    .orderBy(proofArtifacts.proofHash)
    .all();

  return rows.map((row) => row.proofHash);
}

export async function insertProofArtifact(
  data: NewProofArtifact,
  executor: DbExecutor = db
): Promise<void> {
  await executor.insert(proofArtifacts).values(data).run();
}

export async function insertEncryptedAttribute(
  data: Omit<NewEncryptedAttribute, "createdAt" | "ciphertextHash">
): Promise<void> {
  const ciphertextHash = computeCiphertextHash(
    data.ciphertext,
    data.userId,
    data.attributeType
  );
  await db
    .insert(encryptedAttributes)
    .values({
      id: data.id,
      userId: data.userId,
      source: data.source,
      attributeType: data.attributeType,
      ciphertext: data.ciphertext,
      ciphertextHash,
      keyId: data.keyId ?? null,
      encryptionTimeMs: data.encryptionTimeMs ?? null,
    })
    .run();
}

export async function insertSignedClaim(
  data: Omit<SignedClaimRecord, "createdAt">,
  executor: DbExecutor = db
): Promise<void> {
  await executor
    .insert(signedClaims)
    .values({
      id: data.id,
      userId: data.userId,
      verificationId: data.verificationId ?? null,
      claimType: data.claimType,
      claimPayload: data.claimPayload,
      signature: data.signature,
      issuedAt: data.issuedAt,
    })
    .run();
}

export async function upsertCredentialBindingCommitment(data: {
  authContextId?: string | null | undefined;
  commitment: string;
  credentialId: string;
  credentialKind: "passkey" | "opaque" | "wallet";
  id: string;
  secretId: string;
  userId: string;
}): Promise<CredentialBindingCommitmentRecord> {
  await db
    .insert(credentialBindingCommitments)
    .values({
      id: data.id,
      secretId: data.secretId,
      userId: data.userId,
      credentialId: data.credentialId,
      credentialKind: data.credentialKind,
      commitment: data.commitment,
      authContextId: data.authContextId ?? null,
      revokedAt: null,
    })
    .onConflictDoUpdate({
      target: [
        credentialBindingCommitments.secretId,
        credentialBindingCommitments.credentialId,
      ],
      set: {
        credentialKind: data.credentialKind,
        commitment: data.commitment,
        authContextId: data.authContextId ?? null,
        revokedAt: null,
      },
    })
    .run();

  const row = await db
    .select()
    .from(credentialBindingCommitments)
    .where(
      and(
        eq(credentialBindingCommitments.secretId, data.secretId),
        eq(credentialBindingCommitments.credentialId, data.credentialId)
      )
    )
    .limit(1)
    .get();

  if (!row) {
    throw new Error("Failed to upsert credential binding commitment");
  }
  return row;
}

export async function getActiveCredentialBindingCommitments(
  userId: string
): Promise<string[]> {
  const rows = await db
    .select({ commitment: credentialBindingCommitments.commitment })
    .from(credentialBindingCommitments)
    .where(
      and(
        eq(credentialBindingCommitments.userId, userId),
        isNull(credentialBindingCommitments.revokedAt)
      )
    );
  return rows.map((r) => r.commitment);
}

export async function getLatestSignedClaimByUserTypeAndVerification(
  userId: string,
  claimType: string,
  verificationId: string,
  executor: DbExecutor = db
): Promise<SignedClaimRecord | null> {
  const row = await executor
    .select()
    .from(signedClaims)
    .where(
      and(
        eq(signedClaims.userId, userId),
        eq(signedClaims.claimType, claimType),
        eq(signedClaims.verificationId, verificationId)
      )
    )
    .orderBy(desc(signedClaims.issuedAt))
    .limit(1)
    .get();

  return row ?? null;
}
