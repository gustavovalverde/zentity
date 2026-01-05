import type {
  AgeProofFull,
  AgeProofSummary,
} from "../../crypto/age-proof-types";
import type {
  EncryptedSecretRecord,
  NewEncryptedAttribute,
  SecretWrapperRecord,
  SignedClaimRecord,
  ZkProofRecord,
} from "../schema/crypto";

import crypto from "node:crypto";

import { and, desc, eq, sql } from "drizzle-orm";

import { db } from "../connection";
import {
  encryptedAttributes,
  encryptedSecrets,
  secretWrappers,
  signedClaims,
  zkProofs,
} from "../schema/crypto";

export interface ZkProofInsert {
  id: string;
  userId: string;
  documentId?: string | null;
  proofType: string;
  proofHash: string;
  publicInputs?: string | null;
  nonce?: string | null;
  policyVersion?: string | null;
  verified?: boolean;
  proofPayload?: string | null;
  isOver18?: boolean | null;
  generationTimeMs?: number | null;
  circuitType?: string | null;
  noirVersion?: string | null;
  circuitHash?: string | null;
  verificationKeyHash?: string | null;
  verificationKeyPoseidonHash?: string | null;
  bbVersion?: string | null;
}

export type EncryptedSecret = Omit<EncryptedSecretRecord, "metadata"> & {
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

function getCiphertextInfo(ciphertext: Buffer | null | undefined): {
  hash: string | null;
  byteLength: number | null;
} {
  if (!ciphertext || ciphertext.byteLength === 0) {
    return { hash: null, byteLength: null };
  }
  const hash = crypto.createHash("sha256").update(ciphertext).digest("hex");
  return { hash, byteLength: ciphertext.byteLength };
}

export async function getUserAgeProof(
  userId: string
): Promise<AgeProofSummary | null> {
  const proof = await db
    .select({
      id: zkProofs.id,
      isOver18: zkProofs.isOver18,
      generationTimeMs: zkProofs.generationTimeMs,
      createdAt: zkProofs.createdAt,
    })
    .from(zkProofs)
    .where(
      and(
        eq(zkProofs.userId, userId),
        eq(zkProofs.proofType, "age_verification"),
        eq(zkProofs.verified, true)
      )
    )
    .orderBy(desc(zkProofs.createdAt))
    .limit(1)
    .get();

  if (!proof) {
    return null;
  }

  const encrypted = await getLatestEncryptedAttributeByUserAndType(
    userId,
    "birth_year_offset"
  );
  const ciphertextInfo = getCiphertextInfo(encrypted?.ciphertext ?? null);

  return {
    proofId: proof.id,
    isOver18: Boolean(proof.isOver18),
    generationTimeMs: proof.generationTimeMs ?? null,
    createdAt: proof.createdAt,
    birthYearOffsetCiphertextHash: ciphertextInfo.hash,
    birthYearOffsetCiphertextBytes: ciphertextInfo.byteLength,
    fheEncryptionTimeMs: encrypted?.encryptionTimeMs ?? null,
  };
}

export async function getUserAgeProofFull(
  userId: string
): Promise<AgeProofFull | null> {
  const row = await db
    .select({
      id: zkProofs.id,
      isOver18: zkProofs.isOver18,
      generationTimeMs: zkProofs.generationTimeMs,
      createdAt: zkProofs.createdAt,
      proofPayload: zkProofs.proofPayload,
      publicInputs: zkProofs.publicInputs,
      circuitType: zkProofs.circuitType,
      noirVersion: zkProofs.noirVersion,
      circuitHash: zkProofs.circuitHash,
      verificationKeyHash: zkProofs.verificationKeyHash,
      verificationKeyPoseidonHash: zkProofs.verificationKeyPoseidonHash,
      bbVersion: zkProofs.bbVersion,
    })
    .from(zkProofs)
    .where(
      and(
        eq(zkProofs.userId, userId),
        eq(zkProofs.proofType, "age_verification"),
        eq(zkProofs.verified, true)
      )
    )
    .orderBy(desc(zkProofs.createdAt))
    .limit(1)
    .get();

  if (!row) {
    return null;
  }

  const encrypted = await getLatestEncryptedAttributeByUserAndType(
    userId,
    "birth_year_offset"
  );
  const ciphertextInfo = getCiphertextInfo(encrypted?.ciphertext ?? null);

  let publicSignals: string[] | null = null;
  if (row.publicInputs) {
    try {
      const parsed = JSON.parse(row.publicInputs) as unknown;
      if (Array.isArray(parsed)) {
        publicSignals = parsed.map(String);
      }
    } catch {
      publicSignals = null;
    }
  }

  return {
    proofId: row.id,
    isOver18: Boolean(row.isOver18),
    generationTimeMs: row.generationTimeMs ?? null,
    createdAt: row.createdAt,
    birthYearOffsetCiphertextHash: ciphertextInfo.hash,
    birthYearOffsetCiphertextBytes: ciphertextInfo.byteLength,
    fheEncryptionTimeMs: encrypted?.encryptionTimeMs ?? null,
    proof: row.proofPayload ?? null,
    publicSignals,
    fheKeyId: encrypted?.keyId ?? null,
    circuitType: row.circuitType ?? null,
    noirVersion: row.noirVersion ?? null,
    circuitHash: row.circuitHash ?? null,
    verificationKeyHash: row.verificationKeyHash ?? null,
    verificationKeyPoseidonHash: row.verificationKeyPoseidonHash ?? null,
    bbVersion: row.bbVersion ?? null,
  };
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

export async function upsertEncryptedSecret(data: {
  id: string;
  userId: string;
  secretType: string;
  encryptedBlob?: string | null;
  blobRef?: string | null;
  blobHash?: string | null;
  blobSize?: number | null;
  metadata: Record<string, unknown> | null;
  version: string;
}): Promise<EncryptedSecret> {
  const metadata = data.metadata ? JSON.stringify(data.metadata) : null;
  const encryptedBlob = data.encryptedBlob ?? "";

  await db
    .insert(encryptedSecrets)
    .values({
      id: data.id,
      userId: data.userId,
      secretType: data.secretType,
      encryptedBlob,
      blobRef: data.blobRef ?? null,
      blobHash: data.blobHash ?? null,
      blobSize: data.blobSize ?? null,
      metadata,
      version: data.version,
    })
    .onConflictDoUpdate({
      target: [encryptedSecrets.userId, encryptedSecrets.secretType],
      set: {
        encryptedBlob,
        blobRef: data.blobRef ?? null,
        blobHash: data.blobHash ?? null,
        blobSize: data.blobSize ?? null,
        metadata,
        version: data.version,
        updatedAt: sql`datetime('now')`,
      },
    })
    .run();

  const updated = await getEncryptedSecretByUserAndType(
    data.userId,
    data.secretType
  );
  if (!updated) {
    throw new Error("Failed to upsert encrypted secret");
  }
  return updated;
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
  prfSalt: string;
  kekVersion: string;
}): Promise<SecretWrapperRecord> {
  await db
    .insert(secretWrappers)
    .values({
      id: data.id,
      secretId: data.secretId,
      userId: data.userId,
      credentialId: data.credentialId,
      wrappedDek: data.wrappedDek,
      prfSalt: data.prfSalt,
      kekVersion: data.kekVersion,
    })
    .onConflictDoUpdate({
      target: [secretWrappers.secretId, secretWrappers.credentialId],
      set: {
        wrappedDek: data.wrappedDek,
        prfSalt: data.prfSalt,
        kekVersion: data.kekVersion,
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

export async function deleteEncryptedSecretByUserAndType(
  userId: string,
  secretType: string
): Promise<void> {
  await db
    .delete(encryptedSecrets)
    .where(
      and(
        eq(encryptedSecrets.userId, userId),
        eq(encryptedSecrets.secretType, secretType)
      )
    )
    .run();
}

export async function getLatestZkProofPayloadByUserAndType(
  userId: string,
  proofType: string,
  documentId?: string
): Promise<{ proof: string; publicSignals: string[] } | null> {
  const baseConditions = [
    eq(zkProofs.userId, userId),
    eq(zkProofs.proofType, proofType),
  ];

  if (documentId) {
    baseConditions.push(eq(zkProofs.documentId, documentId));
  }

  const row = await db
    .select({
      proofPayload: zkProofs.proofPayload,
      publicInputs: zkProofs.publicInputs,
    })
    .from(zkProofs)
    .where(and(...baseConditions))
    .orderBy(desc(zkProofs.createdAt))
    .limit(1)
    .get();

  if (!(row?.proofPayload && row.publicInputs)) {
    return null;
  }

  try {
    const parsed = JSON.parse(row.publicInputs) as unknown;
    if (!Array.isArray(parsed)) {
      return null;
    }
    return {
      proof: row.proofPayload,
      publicSignals: parsed.map(String),
    };
  } catch {
    return null;
  }
}

export async function getZkProofsByUserId(
  userId: string
): Promise<ZkProofRecord[]> {
  return await db
    .select()
    .from(zkProofs)
    .where(eq(zkProofs.userId, userId))
    .orderBy(desc(zkProofs.createdAt))
    .all();
}

export async function getZkProofTypesByUserAndDocument(
  userId: string,
  documentId: string
): Promise<string[]> {
  const rows = await db
    .select({ proofType: zkProofs.proofType })
    .from(zkProofs)
    .where(
      and(
        eq(zkProofs.userId, userId),
        eq(zkProofs.documentId, documentId),
        eq(zkProofs.verified, true)
      )
    )
    .groupBy(zkProofs.proofType)
    .orderBy(zkProofs.proofType)
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
  keyId: string | null;
  encryptionTimeMs: number | null;
  createdAt: string;
} | null> {
  const row = await db
    .select({
      ciphertext: encryptedAttributes.ciphertext,
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

  return row ?? null;
}

export async function getSignedClaimTypesByUserAndDocument(
  userId: string,
  documentId: string
): Promise<string[]> {
  const rows = await db
    .select({ claimType: signedClaims.claimType })
    .from(signedClaims)
    .where(
      and(
        eq(signedClaims.userId, userId),
        eq(signedClaims.documentId, documentId)
      )
    )
    .groupBy(signedClaims.claimType)
    .orderBy(signedClaims.claimType)
    .all();

  return rows.map((row) => row.claimType);
}

export async function getProofHashesByUserAndDocument(
  userId: string,
  documentId: string
): Promise<string[]> {
  const rows = await db
    .select({ proofHash: zkProofs.proofHash })
    .from(zkProofs)
    .where(
      and(
        eq(zkProofs.userId, userId),
        eq(zkProofs.documentId, documentId),
        eq(zkProofs.verified, true)
      )
    )
    .orderBy(zkProofs.proofHash)
    .all();

  return rows.map((row) => row.proofHash);
}

export async function insertZkProofRecord(data: ZkProofInsert): Promise<void> {
  await db
    .insert(zkProofs)
    .values({
      id: data.id,
      userId: data.userId,
      documentId: data.documentId ?? null,
      proofType: data.proofType,
      proofHash: data.proofHash,
      proofPayload: data.proofPayload ?? null,
      publicInputs: data.publicInputs ?? null,
      isOver18: data.isOver18 ?? null,
      generationTimeMs: data.generationTimeMs ?? null,
      nonce: data.nonce ?? null,
      policyVersion: data.policyVersion ?? null,
      circuitType: data.circuitType ?? null,
      noirVersion: data.noirVersion ?? null,
      circuitHash: data.circuitHash ?? null,
      verificationKeyHash: data.verificationKeyHash ?? null,
      verificationKeyPoseidonHash: data.verificationKeyPoseidonHash ?? null,
      bbVersion: data.bbVersion ?? null,
      verified: data.verified ?? false,
    })
    .run();
}

export async function insertEncryptedAttribute(
  data: Omit<NewEncryptedAttribute, "createdAt">
): Promise<void> {
  await db
    .insert(encryptedAttributes)
    .values({
      id: data.id,
      userId: data.userId,
      source: data.source,
      attributeType: data.attributeType,
      ciphertext: data.ciphertext,
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
      documentId: data.documentId ?? null,
      claimType: data.claimType,
      claimPayload: data.claimPayload,
      signature: data.signature,
      issuedAt: data.issuedAt,
    })
    .run();
}

export async function getLatestSignedClaimByUserTypeAndDocument(
  userId: string,
  claimType: string,
  documentId: string
): Promise<SignedClaimRecord | null> {
  const row = await db
    .select()
    .from(signedClaims)
    .where(
      and(
        eq(signedClaims.userId, userId),
        eq(signedClaims.claimType, claimType),
        eq(signedClaims.documentId, documentId)
      )
    )
    .orderBy(desc(signedClaims.issuedAt))
    .limit(1)
    .get();

  return row ?? null;
}
