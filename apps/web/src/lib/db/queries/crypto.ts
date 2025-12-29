import type {
  AgeProofFull,
  AgeProofSummary,
} from "../../crypto/age-proof-types";
import type {
  NewEncryptedAttribute,
  SignedClaimRecord,
  ZkProofRecord,
} from "../schema";

import { and, desc, eq } from "drizzle-orm";

import { db } from "../connection";
import { encryptedAttributes, signedClaims, zkProofs } from "../schema";

export type ZkProofInsert = {
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
  bbVersion?: string | null;
};

export function getUserAgeProof(userId: string): AgeProofSummary | null {
  const proof = db
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
        eq(zkProofs.verified, true),
      ),
    )
    .orderBy(desc(zkProofs.createdAt))
    .limit(1)
    .get();

  if (!proof) return null;

  const encrypted = getLatestEncryptedAttributeByUserAndType(
    userId,
    "birth_year_offset",
  );

  return {
    proofId: proof.id,
    isOver18: Boolean(proof.isOver18),
    generationTimeMs: proof.generationTimeMs ?? null,
    createdAt: proof.createdAt,
    birthYearOffsetCiphertext: encrypted?.ciphertext ?? null,
    fheEncryptionTimeMs: encrypted?.encryptionTimeMs ?? null,
  };
}

export function getUserAgeProofFull(userId: string): AgeProofFull | null {
  const row = db
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
      bbVersion: zkProofs.bbVersion,
    })
    .from(zkProofs)
    .where(
      and(
        eq(zkProofs.userId, userId),
        eq(zkProofs.proofType, "age_verification"),
        eq(zkProofs.verified, true),
      ),
    )
    .orderBy(desc(zkProofs.createdAt))
    .limit(1)
    .get();

  if (!row) return null;

  const encrypted = getLatestEncryptedAttributeByUserAndType(
    userId,
    "birth_year_offset",
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
    birthYearOffsetCiphertext: encrypted?.ciphertext ?? null,
    fheEncryptionTimeMs: encrypted?.encryptionTimeMs ?? null,
    proof: row.proofPayload ?? null,
    publicSignals,
    fheKeyId: encrypted?.keyId ?? null,
    circuitType: row.circuitType ?? null,
    noirVersion: row.noirVersion ?? null,
    circuitHash: row.circuitHash ?? null,
    bbVersion: row.bbVersion ?? null,
  };
}

export function getLatestZkProofPayloadByUserAndType(
  userId: string,
  proofType: string,
  documentId?: string,
): { proof: string; publicSignals: string[] } | null {
  const baseConditions = [
    eq(zkProofs.userId, userId),
    eq(zkProofs.proofType, proofType),
  ];

  if (documentId) {
    baseConditions.push(eq(zkProofs.documentId, documentId));
  }

  const row = db
    .select({
      proofPayload: zkProofs.proofPayload,
      publicInputs: zkProofs.publicInputs,
    })
    .from(zkProofs)
    .where(and(...baseConditions))
    .orderBy(desc(zkProofs.createdAt))
    .limit(1)
    .get();

  if (!row?.proofPayload || !row.publicInputs) return null;

  try {
    const parsed = JSON.parse(row.publicInputs) as unknown;
    if (!Array.isArray(parsed)) return null;
    return {
      proof: row.proofPayload,
      publicSignals: parsed.map(String),
    };
  } catch {
    return null;
  }
}

export function getZkProofsByUserId(userId: string): ZkProofRecord[] {
  return db
    .select()
    .from(zkProofs)
    .where(eq(zkProofs.userId, userId))
    .orderBy(desc(zkProofs.createdAt))
    .all();
}

export function getZkProofTypesByUserAndDocument(
  userId: string,
  documentId: string,
): string[] {
  const rows = db
    .select({ proofType: zkProofs.proofType })
    .from(zkProofs)
    .where(
      and(
        eq(zkProofs.userId, userId),
        eq(zkProofs.documentId, documentId),
        eq(zkProofs.verified, true),
      ),
    )
    .groupBy(zkProofs.proofType)
    .orderBy(zkProofs.proofType)
    .all();

  return rows.map((row) => row.proofType);
}

export function getEncryptedAttributeTypesByUserId(userId: string): string[] {
  const rows = db
    .select({ attributeType: encryptedAttributes.attributeType })
    .from(encryptedAttributes)
    .where(eq(encryptedAttributes.userId, userId))
    .groupBy(encryptedAttributes.attributeType)
    .orderBy(encryptedAttributes.attributeType)
    .all();

  return rows.map((row) => row.attributeType);
}

export function getLatestEncryptedAttributeByUserAndType(
  userId: string,
  attributeType: string,
): {
  ciphertext: string;
  keyId: string | null;
  encryptionTimeMs: number | null;
  createdAt: string;
} | null {
  const row = db
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
        eq(encryptedAttributes.attributeType, attributeType),
      ),
    )
    .orderBy(desc(encryptedAttributes.createdAt))
    .limit(1)
    .get();

  return row ?? null;
}

export function getSignedClaimTypesByUserAndDocument(
  userId: string,
  documentId: string,
): string[] {
  const rows = db
    .select({ claimType: signedClaims.claimType })
    .from(signedClaims)
    .where(
      and(
        eq(signedClaims.userId, userId),
        eq(signedClaims.documentId, documentId),
      ),
    )
    .groupBy(signedClaims.claimType)
    .orderBy(signedClaims.claimType)
    .all();

  return rows.map((row) => row.claimType);
}

export function getProofHashesByUserAndDocument(
  userId: string,
  documentId: string,
): string[] {
  const rows = db
    .select({ proofHash: zkProofs.proofHash })
    .from(zkProofs)
    .where(
      and(
        eq(zkProofs.userId, userId),
        eq(zkProofs.documentId, documentId),
        eq(zkProofs.verified, true),
      ),
    )
    .orderBy(zkProofs.proofHash)
    .all();

  return rows.map((row) => row.proofHash);
}

export function insertZkProofRecord(data: ZkProofInsert): void {
  db.insert(zkProofs)
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
      bbVersion: data.bbVersion ?? null,
      verified: data.verified ?? false,
    })
    .run();
}

export function insertEncryptedAttribute(
  data: Omit<NewEncryptedAttribute, "createdAt">,
): void {
  db.insert(encryptedAttributes)
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

export function insertSignedClaim(
  data: Omit<SignedClaimRecord, "createdAt">,
): void {
  db.insert(signedClaims)
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

export function getLatestSignedClaimByUserTypeAndDocument(
  userId: string,
  claimType: string,
  documentId: string,
): SignedClaimRecord | null {
  const row = db
    .select()
    .from(signedClaims)
    .where(
      and(
        eq(signedClaims.userId, userId),
        eq(signedClaims.claimType, claimType),
        eq(signedClaims.documentId, documentId),
      ),
    )
    .orderBy(desc(signedClaims.issuedAt))
    .limit(1)
    .get();

  return row ?? null;
}
