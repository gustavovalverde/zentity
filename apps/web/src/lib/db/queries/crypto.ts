import type {
  AgeProofFull,
  AgeProofSummary,
} from "../../privacy/zk/age-proof-types";
import type {
  EncryptedSecretRecord,
  NewEncryptedAttribute,
  SecretWrapperRecord,
  SignedClaimRecord,
  ZkProofRecord,
  ZkProofSessionRecord,
} from "../schema/crypto";

import crypto from "node:crypto";

import { and, desc, eq, sql } from "drizzle-orm";

import { env } from "@/env";
import { encodeAad } from "@/lib/privacy/primitives/aad";

import { db } from "../connection";
import {
  encryptedAttributes,
  encryptedSecrets,
  secretWrappers,
  signedClaims,
  zkProofSessions,
  zkProofs,
} from "../schema/crypto";

export interface ZkProofInsert {
  bbVersion?: string | null | undefined;
  circuitHash?: string | null | undefined;
  circuitType?: string | null | undefined;
  generationTimeMs?: number | null | undefined;
  id: string;
  isOver18?: boolean | null | undefined;
  noirVersion?: string | null | undefined;
  nonce?: string | null | undefined;
  policyVersion?: string | null | undefined;
  proofHash: string;
  proofPayload?: string | null | undefined;
  proofSessionId: string;
  proofType: string;
  publicInputs?: string | null | undefined;
  userId: string;
  verificationId?: string | null | undefined;
  verificationKeyHash?: string | null | undefined;
  verificationKeyPoseidonHash?: string | null | undefined;
  verified?: boolean | undefined;
}

export interface ZkProofSessionInsert {
  audience: string;
  createdAt: number;
  expiresAt: number;
  id: string;
  msgSender: string;
  policyVersion: string;
  userId: string;
  verificationId: string;
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

function computeCiphertextHash(
  ciphertext: Buffer,
  userId: string,
  attributeType: string
): string {
  const context = encodeAad([userId, attributeType]);
  return crypto
    .createHmac("sha256", env.BETTER_AUTH_SECRET)
    .update(context)
    .update(ciphertext)
    .digest("hex");
}

function getCiphertextInfo(
  ciphertext: Buffer | null | undefined,
  userId: string,
  attributeType: string
): {
  hash: string | null;
  byteLength: number | null;
} {
  if (!ciphertext || ciphertext.byteLength === 0) {
    return { hash: null, byteLength: null };
  }
  return {
    hash: computeCiphertextHash(ciphertext, userId, attributeType),
    byteLength: ciphertext.byteLength,
  };
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

  // Check for dob_days first (new format), then fall back to birth_year_offset (legacy)
  let encrypted = await getLatestEncryptedAttributeByUserAndType(
    userId,
    "dob_days"
  );
  let dobAttrType = "dob_days";
  if (!encrypted) {
    encrypted = await getLatestEncryptedAttributeByUserAndType(
      userId,
      "birth_year_offset"
    );
    dobAttrType = "birth_year_offset";
  }
  const ciphertextInfo = getCiphertextInfo(
    encrypted?.ciphertext ?? null,
    userId,
    dobAttrType
  );

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

  // Check for dob_days first (new format), then fall back to birth_year_offset (legacy)
  let encrypted = await getLatestEncryptedAttributeByUserAndType(
    userId,
    "dob_days"
  );
  let dobAttrType2 = "dob_days";
  if (!encrypted) {
    encrypted = await getLatestEncryptedAttributeByUserAndType(
      userId,
      "birth_year_offset"
    );
    dobAttrType2 = "birth_year_offset";
  }
  const ciphertextInfo = getCiphertextInfo(
    encrypted?.ciphertext ?? null,
    userId,
    dobAttrType2
  );

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
    })
    .onConflictDoUpdate({
      target: [encryptedSecrets.userId, encryptedSecrets.secretType],
      set: {
        encryptedBlob,
        blobRef: data.blobRef ?? null,
        blobHash: data.blobHash ?? null,
        blobSize: data.blobSize ?? null,
        metadata,
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
  verificationId?: string
): Promise<{ proof: string; publicSignals: string[] } | null> {
  const baseConditions = [
    eq(zkProofs.userId, userId),
    eq(zkProofs.proofType, proofType),
  ];

  if (verificationId) {
    baseConditions.push(eq(zkProofs.verificationId, verificationId));
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

/**
 * Get all verified ZK proofs for a user with full details.
 * Used by the dev page to display proof metadata.
 */
export async function getAllVerifiedProofsFull(userId: string): Promise<
  {
    proofId: string;
    proofType: string;
    generationTimeMs: number | null;
    createdAt: string;
    proof: string | null;
    publicSignals: string[] | null;
    circuitType: string | null;
    noirVersion: string | null;
    circuitHash: string | null;
    verificationKeyHash: string | null;
    verificationKeyPoseidonHash: string | null;
    bbVersion: string | null;
  }[]
> {
  const rows = await db
    .select({
      id: zkProofs.id,
      proofType: zkProofs.proofType,
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
    .where(and(eq(zkProofs.userId, userId), eq(zkProofs.verified, true)))
    .orderBy(desc(zkProofs.createdAt))
    .all();

  return rows.map((row) => {
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
      proofType: row.proofType,
      generationTimeMs: row.generationTimeMs ?? null,
      createdAt: row.createdAt,
      proof: row.proofPayload ?? null,
      publicSignals,
      circuitType: row.circuitType ?? null,
      noirVersion: row.noirVersion ?? null,
      circuitHash: row.circuitHash ?? null,
      verificationKeyHash: row.verificationKeyHash ?? null,
      verificationKeyPoseidonHash: row.verificationKeyPoseidonHash ?? null,
      bbVersion: row.bbVersion ?? null,
    };
  });
}

export async function createZkProofSession(
  data: ZkProofSessionInsert
): Promise<void> {
  await db
    .insert(zkProofSessions)
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

export async function getZkProofSessionById(
  id: string
): Promise<ZkProofSessionRecord | null> {
  const row = await db
    .select()
    .from(zkProofSessions)
    .where(eq(zkProofSessions.id, id))
    .limit(1)
    .get();
  return row ?? null;
}

export async function closeZkProofSession(id: string): Promise<void> {
  await db
    .update(zkProofSessions)
    .set({
      closedAt: Date.now(),
    })
    .where(eq(zkProofSessions.id, id))
    .run();
}

export async function getZkProofTypesByUserAndVerification(
  userId: string,
  verificationId: string
): Promise<string[]> {
  const rows = await db
    .select({ proofType: zkProofs.proofType })
    .from(zkProofs)
    .where(
      and(
        eq(zkProofs.userId, userId),
        eq(zkProofs.verificationId, verificationId),
        eq(zkProofs.verified, true)
      )
    )
    .groupBy(zkProofs.proofType)
    .orderBy(zkProofs.proofType)
    .all();

  return rows.map((row) => row.proofType);
}

export async function getZkProofTypesByUserVerificationAndSession(
  userId: string,
  verificationId: string,
  proofSessionId: string
): Promise<string[]> {
  const rows = await db
    .select({ proofType: zkProofs.proofType })
    .from(zkProofs)
    .where(
      and(
        eq(zkProofs.userId, userId),
        eq(zkProofs.verificationId, verificationId),
        eq(zkProofs.proofSessionId, proofSessionId),
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

export async function getProofHashesByUserAndVerification(
  userId: string,
  verificationId: string
): Promise<string[]> {
  const rows = await db
    .select({ proofHash: zkProofs.proofHash })
    .from(zkProofs)
    .where(
      and(
        eq(zkProofs.userId, userId),
        eq(zkProofs.verificationId, verificationId),
        eq(zkProofs.verified, true)
      )
    )
    .orderBy(zkProofs.proofHash)
    .all();

  return rows.map((row) => row.proofHash);
}

export async function getProofHashesByUserVerificationAndSession(
  userId: string,
  verificationId: string,
  proofSessionId: string
): Promise<string[]> {
  const rows = await db
    .select({ proofHash: zkProofs.proofHash })
    .from(zkProofs)
    .where(
      and(
        eq(zkProofs.userId, userId),
        eq(zkProofs.verificationId, verificationId),
        eq(zkProofs.proofSessionId, proofSessionId),
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
      verificationId: data.verificationId ?? null,
      proofSessionId: data.proofSessionId,
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
