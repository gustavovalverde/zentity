import type {
  EncryptedSecretRecord,
  NewEncryptedAttribute,
  ProofSessionRecord,
  SecretWrapperRecord,
  SignedClaimRecord,
} from "../schema/privacy";

import crypto from "node:crypto";

import { and, desc, eq, sql } from "drizzle-orm";

import { getCiphertextHmacKey } from "@/lib/privacy/primitives/derived-keys";
import { encodeAad } from "@/lib/privacy/primitives/symmetric";

import { db } from "../connection";
import {
  encryptedAttributes,
  encryptedSecrets,
  proofArtifacts,
  proofSessions,
  secretWrappers,
  signedClaims,
} from "../schema/privacy";

interface ProofArtifactInsert {
  generationTimeMs?: number | null | undefined;
  id: string;
  metadata?: string | null | undefined;
  nonce?: string | null | undefined;
  policyVersion?: string | null | undefined;
  proofHash: string;
  proofPayload?: string | null | undefined;
  proofSessionId?: string | null | undefined;
  proofSystem: string;
  proofType: string;
  publicInputs?: string | null | undefined;
  userId: string;
  verificationId?: string | null | undefined;
  verified?: boolean | undefined;
}

interface ProofSessionInsert {
  audience: string;
  createdAt: number;
  expiresAt: number;
  id: string;
  msgSender: string;
  policyVersion: string;
  userId: string;
  verificationId: string;
}

type EncryptedSecret = Omit<EncryptedSecretRecord, "metadata"> & {
  metadata: Record<string, unknown> | null;
};

function parseSecretMetadata(
  raw: string | null
): Record<string, unknown> | null {
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

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

  if (!crypto.timingSafeEqual(Buffer.from(stored), Buffer.from(computed))) {
    throw new Error(
      `Encrypted attribute integrity check failed for ${params.attributeType}:${params.userId}`
    );
  }

  return stored;
}

export async function getEncryptedSecretByUserAndType(
  userId: string,
  secretType: string
): Promise<EncryptedSecret | null> {
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

  if (!row) {
    return null;
  }

  return {
    ...row,
    metadata: parseSecretMetadata(row.metadata),
  };
}

export async function getEncryptedSecretById(
  userId: string,
  secretId: string
): Promise<EncryptedSecret | null> {
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

  if (!row) {
    return null;
  }

  return {
    ...row,
    metadata: parseSecretMetadata(row.metadata),
  };
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
}): Promise<EncryptedSecret | null> {
  const metadata = data.metadata ? JSON.stringify(data.metadata) : null;

  await db
    .update(encryptedSecrets)
    .set({
      metadata,
      updatedAt: sql`datetime('now')`,
    })
    .where(
      and(
        eq(encryptedSecrets.userId, data.userId),
        eq(encryptedSecrets.secretType, data.secretType)
      )
    )
    .run();

  return await getEncryptedSecretByUserAndType(data.userId, data.secretType);
}

export async function upsertSecretWrapper(data: {
  id: string;
  secretId: string;
  userId: string;
  credentialId: string;
  wrappedDek: string;
  prfSalt?: string | null | undefined;
  kekSource?: string | undefined;
  baseCommitment?: string | null | undefined;
}): Promise<SecretWrapperRecord> {
  const kekSource = data.kekSource ?? "prf";

  await db
    .insert(secretWrappers)
    .values({
      id: data.id,
      secretId: data.secretId,
      userId: data.userId,
      credentialId: data.credentialId,
      wrappedDek: data.wrappedDek,
      prfSalt: data.prfSalt ?? null,
      kekSource,
      baseCommitment: data.baseCommitment ?? null,
    })
    .onConflictDoUpdate({
      target: [secretWrappers.secretId, secretWrappers.credentialId],
      set: {
        wrappedDek: data.wrappedDek,
        prfSalt: data.prfSalt ?? null,
        kekSource,
        baseCommitment: data.baseCommitment ?? null,
        updatedAt: sql`datetime('now')`,
      },
    })
    .run();

  const wrappers = await getSecretWrappersBySecretId(data.secretId);
  const match = wrappers.find(
    (wrapper) => wrapper.credentialId === data.credentialId
  );
  if (!match) {
    throw new Error("Failed to upsert secret wrapper");
  }
  return match;
}

export async function deleteSecretWrapper(
  secretId: string,
  credentialId: string
): Promise<void> {
  await db
    .delete(secretWrappers)
    .where(
      and(
        eq(secretWrappers.secretId, secretId),
        eq(secretWrappers.credentialId, credentialId)
      )
    )
    .run();
}

export async function createProofSession(
  data: ProofSessionInsert
): Promise<void> {
  await db
    .insert(proofSessions)
    .values({
      id: data.id,
      userId: data.userId,
      verificationId: data.verificationId,
      msgSender: data.msgSender,
      audience: data.audience,
      policyVersion: data.policyVersion,
      createdAt: data.createdAt,
      expiresAt: data.expiresAt,
      closedAt: null,
    })
    .run();
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

export async function closeProofSession(id: string): Promise<void> {
  await db
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
  proofSessionId: string
): Promise<string[]> {
  const rows = await db
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

export async function listEncryptedSecretsByUserId(
  userId: string
): Promise<EncryptedSecret[]> {
  const rows = await db
    .select()
    .from(encryptedSecrets)
    .where(eq(encryptedSecrets.userId, userId))
    .all();
  return rows.map((row) => ({
    ...row,
    metadata: parseSecretMetadata(row.metadata),
  }));
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
  proofSessionId: string
): Promise<string[]> {
  const rows = await db
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
  data: ProofArtifactInsert
): Promise<void> {
  await db
    .insert(proofArtifacts)
    .values({
      id: data.id,
      userId: data.userId,
      verificationId: data.verificationId ?? null,
      proofSessionId: data.proofSessionId ?? null,
      proofSystem: data.proofSystem,
      proofType: data.proofType,
      proofHash: data.proofHash,
      proofPayload: data.proofPayload ?? null,
      publicInputs: data.publicInputs ?? null,
      generationTimeMs: data.generationTimeMs ?? null,
      nonce: data.nonce ?? null,
      policyVersion: data.policyVersion ?? null,
      metadata: data.metadata ?? null,
      verified: data.verified ?? false,
    })
    .run();
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
  data: Omit<SignedClaimRecord, "createdAt">
): Promise<void> {
  await db
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

export async function getUserBaseCommitments(
  userId: string
): Promise<string[]> {
  const rows = await db
    .select({ baseCommitment: secretWrappers.baseCommitment })
    .from(secretWrappers)
    .where(eq(secretWrappers.userId, userId));
  return rows.map((r) => r.baseCommitment).filter(Boolean) as string[];
}

export async function getLatestSignedClaimByUserTypeAndVerification(
  userId: string,
  claimType: string,
  verificationId: string
): Promise<SignedClaimRecord | null> {
  const row = await db
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
