import type {
  FheStatus,
  IdentityBundle,
  IdentityBundleStatus,
  IdentityDocument,
  IdentityJobStatus,
  IdentityVerificationDraft,
  IdentityVerificationJob,
} from "../schema/identity";

import { and, desc, eq, sql } from "drizzle-orm";
// React.cache() is per-request memoization - NOT persistent across requests.
// Safe for shared computers: each HTTP request gets isolated cache scope.
import { cache } from "react";

import { db } from "../connection";
import { attestationEvidence } from "../schema/attestation";
import {
  encryptedAttributes,
  encryptedSecrets,
  secretWrappers,
  signedClaims,
  zkProofs,
} from "../schema/crypto";
import {
  identityBundles,
  identityDocuments,
  identityVerificationDrafts,
  identityVerificationJobs,
} from "../schema/identity";
import {
  getSignedClaimTypesByUserAndDocument,
  getZkProofTypesByUserAndDocument,
} from "./crypto";

export async function documentHashExists(
  documentHash: string
): Promise<boolean> {
  const row = await db
    .select({ id: identityDocuments.id })
    .from(identityDocuments)
    .where(eq(identityDocuments.documentHash, documentHash))
    .get();

  return !!row;
}

export async function deleteIdentityData(userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .delete(attestationEvidence)
      .where(eq(attestationEvidence.userId, userId))
      .run();
    await tx.delete(signedClaims).where(eq(signedClaims.userId, userId)).run();
    await tx
      .delete(encryptedAttributes)
      .where(eq(encryptedAttributes.userId, userId))
      .run();
    await tx
      .delete(secretWrappers)
      .where(eq(secretWrappers.userId, userId))
      .run();
    await tx
      .delete(encryptedSecrets)
      .where(eq(encryptedSecrets.userId, userId))
      .run();
    await tx.delete(zkProofs).where(eq(zkProofs.userId, userId)).run();
    await tx
      .delete(identityVerificationJobs)
      .where(eq(identityVerificationJobs.userId, userId))
      .run();
    await tx
      .delete(identityVerificationDrafts)
      .where(eq(identityVerificationDrafts.userId, userId))
      .run();
    await tx
      .delete(identityDocuments)
      .where(eq(identityDocuments.userId, userId))
      .run();
    await tx
      .delete(identityBundles)
      .where(eq(identityBundles.userId, userId))
      .run();
  });
}

export const getVerificationStatus = cache(async function getVerificationStatus(
  userId: string
): Promise<{
  verified: boolean;
  level: "none" | "basic" | "full";
  checks: {
    document: boolean;
    liveness: boolean;
    ageProof: boolean;
    docValidityProof: boolean;
    nationalityProof: boolean;
    faceMatchProof: boolean;
    identityBindingProof: boolean;
  };
}> {
  const selectedDocument = await getSelectedIdentityDocumentByUserId(userId);
  const documentId = selectedDocument?.id ?? null;

  // Parallelize queries that don't depend on each other
  const [zkProofTypes, signedClaimTypes] = await Promise.all([
    documentId
      ? getZkProofTypesByUserAndDocument(userId, documentId)
      : Promise.resolve([]),
    documentId
      ? getSignedClaimTypesByUserAndDocument(userId, documentId)
      : Promise.resolve([]),
  ]);

  // Core verification checks required for Tier 3
  const coreChecks = {
    document: selectedDocument?.status === "verified",
    liveness: signedClaimTypes.includes("liveness_score"),
    ageProof: zkProofTypes.includes("age_verification"),
    docValidityProof: zkProofTypes.includes("doc_validity"),
    nationalityProof: zkProofTypes.includes("nationality_membership"),
    // Accept either ZK proof (Tier 3) or signed claim (Tier 2) for face match
    faceMatchProof:
      zkProofTypes.includes("face_match") ||
      signedClaimTypes.includes("face_match_score"),
  };

  // identity_binding is NOT required for Tier 3 verification but IS required
  // for on-chain attestation. It's included in the response for UI display
  // but excluded from the verification calculation.
  const checks = {
    ...coreChecks,
    identityBindingProof: zkProofTypes.includes("identity_binding"),
  };

  // Only count core checks for verification status (excludes identity binding)
  const passedChecks = Object.values(coreChecks).filter(Boolean).length;
  const totalChecks = Object.values(coreChecks).length;

  let level: "none" | "basic" | "full" = "none";
  if (passedChecks === totalChecks) {
    level = "full";
  } else if (passedChecks >= Math.ceil(totalChecks / 2)) {
    level = "basic";
  }

  return {
    verified: level === "full",
    level,
    checks,
  };
});

export const getIdentityBundleByUserId = cache(
  async function getIdentityBundleByUserId(
    userId: string
  ): Promise<IdentityBundle | null> {
    const row = await db
      .select()
      .from(identityBundles)
      .where(eq(identityBundles.userId, userId))
      .limit(1)
      .get();

    return row ?? null;
  }
);

/**
 * Check if user has completed sign-up by verifying identity bundle exists.
 * The identity bundle is created only when FHE enrollment completes (passkey or password flow).
 */
export const hasCompletedSignUp = cache(async function hasCompletedSignUp(
  userId: string
): Promise<boolean> {
  const bundle = await getIdentityBundleByUserId(userId);
  return bundle !== null;
});

export async function getLatestIdentityDocumentByUserId(
  userId: string
): Promise<IdentityDocument | null> {
  const row = await db
    .select()
    .from(identityDocuments)
    .where(eq(identityDocuments.userId, userId))
    .orderBy(
      sql`CASE WHEN ${identityDocuments.verifiedAt} IS NULL THEN 1 ELSE 0 END`,
      desc(identityDocuments.verifiedAt),
      desc(identityDocuments.createdAt)
    )
    .limit(1)
    .get();

  return row ?? null;
}

export async function getIdentityDocumentsByUserId(
  userId: string
): Promise<IdentityDocument[]> {
  return await db
    .select()
    .from(identityDocuments)
    .where(eq(identityDocuments.userId, userId))
    .orderBy(
      sql`CASE WHEN ${identityDocuments.verifiedAt} IS NULL THEN 1 ELSE 0 END`,
      desc(identityDocuments.verifiedAt),
      desc(identityDocuments.createdAt)
    )
    .all();
}

export const getSelectedIdentityDocumentByUserId = cache(
  async function getSelectedIdentityDocumentByUserId(
    userId: string
  ): Promise<IdentityDocument | null> {
    // Parallelize all three independent queries
    const [documents, proofRows, claimRows] = await Promise.all([
      getIdentityDocumentsByUserId(userId),
      db
        .select({
          documentId: zkProofs.documentId,
          proofType: zkProofs.proofType,
          verified: zkProofs.verified,
        })
        .from(zkProofs)
        .where(eq(zkProofs.userId, userId))
        .all(),
      db
        .select({
          documentId: signedClaims.documentId,
          claimType: signedClaims.claimType,
        })
        .from(signedClaims)
        .where(eq(signedClaims.userId, userId))
        .all(),
    ]);

    if (documents.length === 0) {
      return null;
    }

    const proofTypesByDocument = new Map<string, Set<string>>();
    for (const row of proofRows) {
      if (!(row.documentId && row.verified)) {
        continue;
      }
      if (!proofTypesByDocument.has(row.documentId)) {
        proofTypesByDocument.set(row.documentId, new Set());
      }
      proofTypesByDocument.get(row.documentId)?.add(row.proofType);
    }

    const claimTypesByDocument = new Map<string, Set<string>>();
    for (const row of claimRows) {
      if (!row.documentId) {
        continue;
      }
      if (!claimTypesByDocument.has(row.documentId)) {
        claimTypesByDocument.set(row.documentId, new Set());
      }
      claimTypesByDocument.get(row.documentId)?.add(row.claimType);
    }

    const requiredProofs = [
      "age_verification",
      "doc_validity",
      "nationality_membership",
      "face_match",
    ];
    const requiredClaims = ["ocr_result", "liveness_score", "face_match_score"];

    const hasAll = (set: Set<string> | undefined, required: string[]) =>
      required.every((item) => set?.has(item));

    for (const doc of documents) {
      if (doc.status !== "verified") {
        continue;
      }
      const proofs = proofTypesByDocument.get(doc.id);
      const claims = claimTypesByDocument.get(doc.id);
      if (hasAll(proofs, requiredProofs) && hasAll(claims, requiredClaims)) {
        return doc;
      }
    }

    for (const doc of documents) {
      if (doc.status === "verified") {
        return doc;
      }
    }

    return documents[0] ?? null;
  }
);

export async function getIdentityDraftById(
  draftId: string
): Promise<IdentityVerificationDraft | null> {
  const row = await db
    .select()
    .from(identityVerificationDrafts)
    .where(eq(identityVerificationDrafts.id, draftId))
    .limit(1)
    .get();

  return row ?? null;
}

export async function getLatestIdentityDraftByUserId(
  userId: string
): Promise<IdentityVerificationDraft | null> {
  const row = await db
    .select()
    .from(identityVerificationDrafts)
    .where(eq(identityVerificationDrafts.userId, userId))
    .orderBy(desc(identityVerificationDrafts.updatedAt))
    .limit(1)
    .get();

  return row ?? null;
}

export async function getLatestIdentityDraftByUserAndDocument(
  userId: string,
  documentId: string
): Promise<IdentityVerificationDraft | null> {
  const row = await db
    .select()
    .from(identityVerificationDrafts)
    .where(
      and(
        eq(identityVerificationDrafts.userId, userId),
        eq(identityVerificationDrafts.documentId, documentId)
      )
    )
    .orderBy(desc(identityVerificationDrafts.updatedAt))
    .limit(1)
    .get();

  return row ?? null;
}

export async function upsertIdentityDraft(
  data: Partial<IdentityVerificationDraft> & {
    id: string;
    userId: string;
    documentId: string;
  }
): Promise<IdentityVerificationDraft> {
  const now = new Date().toISOString();
  await db
    .insert(identityVerificationDrafts)
    .values({
      id: data.id,
      userId: data.userId,
      documentId: data.documentId,
      documentProcessed: data.documentProcessed ?? false,
      isDocumentValid: data.isDocumentValid ?? false,
      isDuplicateDocument: data.isDuplicateDocument ?? false,
      documentType: data.documentType ?? null,
      issuerCountry: data.issuerCountry ?? null,
      documentHash: data.documentHash ?? null,
      documentHashField: data.documentHashField ?? null,
      nameCommitment: data.nameCommitment ?? null,
      ageClaimHash: data.ageClaimHash ?? null,
      docValidityClaimHash: data.docValidityClaimHash ?? null,
      nationalityClaimHash: data.nationalityClaimHash ?? null,
      confidenceScore: data.confidenceScore ?? null,
      ocrIssues: data.ocrIssues ?? null,
      antispoofScore: data.antispoofScore ?? null,
      liveScore: data.liveScore ?? null,
      livenessPassed: data.livenessPassed ?? null,
      faceMatchConfidence: data.faceMatchConfidence ?? null,
      faceMatchPassed: data.faceMatchPassed ?? null,
      dobDays: data.dobDays ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: identityVerificationDrafts.id,
      set: {
        userId: data.userId,
        documentId: data.documentId,
        documentProcessed: data.documentProcessed ?? false,
        isDocumentValid: data.isDocumentValid ?? false,
        isDuplicateDocument: data.isDuplicateDocument ?? false,
        documentType: data.documentType ?? null,
        issuerCountry: data.issuerCountry ?? null,
        documentHash: data.documentHash ?? null,
        documentHashField: data.documentHashField ?? null,
        nameCommitment: data.nameCommitment ?? null,
        ageClaimHash: data.ageClaimHash ?? null,
        docValidityClaimHash: data.docValidityClaimHash ?? null,
        nationalityClaimHash: data.nationalityClaimHash ?? null,
        confidenceScore: data.confidenceScore ?? null,
        ocrIssues: data.ocrIssues ?? null,
        antispoofScore: data.antispoofScore ?? null,
        liveScore: data.liveScore ?? null,
        livenessPassed: data.livenessPassed ?? null,
        faceMatchConfidence: data.faceMatchConfidence ?? null,
        faceMatchPassed: data.faceMatchPassed ?? null,
        dobDays: data.dobDays ?? null,
        updatedAt: sql`datetime('now')`,
      },
    })
    .run();

  const updated = await getIdentityDraftById(data.id);
  if (!updated) {
    throw new Error("Failed to upsert identity draft");
  }
  return updated;
}

export async function updateIdentityDraft(
  draftId: string,
  updates: Partial<IdentityVerificationDraft>
): Promise<void> {
  await db
    .update(identityVerificationDrafts)
    .set({
      ...updates,
      updatedAt: sql`datetime('now')`,
    })
    .where(eq(identityVerificationDrafts.id, draftId))
    .run();
}

export async function getIdentityVerificationJobById(
  jobId: string
): Promise<IdentityVerificationJob | null> {
  const row = await db
    .select()
    .from(identityVerificationJobs)
    .where(eq(identityVerificationJobs.id, jobId))
    .limit(1)
    .get();

  return row ?? null;
}

export async function getLatestIdentityVerificationJobForDraft(
  draftId: string
): Promise<IdentityVerificationJob | null> {
  const row = await db
    .select()
    .from(identityVerificationJobs)
    .where(eq(identityVerificationJobs.draftId, draftId))
    .orderBy(desc(identityVerificationJobs.createdAt))
    .limit(1)
    .get();

  return row ?? null;
}

export async function createIdentityVerificationJob(args: {
  id: string;
  draftId: string;
  userId: string;
  fheKeyId?: string | null;
}): Promise<void> {
  await db
    .insert(identityVerificationJobs)
    .values({
      id: args.id,
      draftId: args.draftId,
      userId: args.userId,
      status: "queued",
      fheKeyId: args.fheKeyId ?? null,
      attempts: 0,
    })
    .run();
}

export async function updateIdentityVerificationJobStatus(args: {
  jobId: string;
  status: IdentityJobStatus;
  error?: string | null;
  result?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  attempts?: number;
}): Promise<void> {
  const updates: Partial<typeof identityVerificationJobs.$inferInsert> = {
    status: args.status,
    error: args.error ?? null,
    result: args.result ?? null,
    startedAt: args.startedAt ?? null,
    finishedAt: args.finishedAt ?? null,
  };

  if (args.attempts !== undefined) {
    updates.attempts = args.attempts;
  }

  await db
    .update(identityVerificationJobs)
    .set({ ...updates, updatedAt: sql`datetime('now')` })
    .where(eq(identityVerificationJobs.id, args.jobId))
    .run();
}

export async function upsertIdentityBundle(data: {
  userId: string;
  walletAddress?: string | null;
  status?: IdentityBundleStatus;
  policyVersion?: string | null;
  issuerId?: string | null;
  attestationExpiresAt?: string | null;
  fheKeyId?: string | null;
  fheStatus?: FheStatus | null;
  fheError?: string | null;
}): Promise<void> {
  await db
    .insert(identityBundles)
    .values({
      userId: data.userId,
      walletAddress: data.walletAddress ?? null,
      status: data.status ?? "pending",
      policyVersion: data.policyVersion ?? null,
      issuerId: data.issuerId ?? null,
      attestationExpiresAt: data.attestationExpiresAt ?? null,
      fheKeyId: data.fheKeyId ?? null,
      fheStatus: data.fheStatus ?? null,
      fheError: data.fheError ?? null,
    })
    .onConflictDoUpdate({
      target: identityBundles.userId,
      set: {
        walletAddress: data.walletAddress ?? null,
        status: data.status ?? "pending",
        policyVersion: data.policyVersion ?? null,
        issuerId: data.issuerId ?? null,
        attestationExpiresAt: data.attestationExpiresAt ?? null,
        fheKeyId: data.fheKeyId ?? null,
        fheStatus: data.fheStatus ?? null,
        fheError: data.fheError ?? null,
        updatedAt: sql`datetime('now')`,
      },
    })
    .run();
}

export async function updateIdentityBundleFheStatus(args: {
  userId: string;
  fheStatus: FheStatus | null;
  fheError?: string | null;
  fheKeyId?: string | null;
}): Promise<void> {
  const updates: Partial<typeof identityBundles.$inferInsert> = {
    fheStatus: args.fheStatus ?? null,
    fheError: args.fheError ?? null,
  };
  if (args.fheKeyId !== undefined) {
    updates.fheKeyId = args.fheKeyId;
  }

  await db
    .update(identityBundles)
    .set({
      ...updates,
      updatedAt: sql`datetime('now')`,
    })
    .where(eq(identityBundles.userId, args.userId))
    .run();
}

export async function updateIdentityBundleStatus(args: {
  userId: string;
  status: IdentityBundleStatus;
  policyVersion?: string | null;
  issuerId?: string | null;
  attestationExpiresAt?: string | null;
}): Promise<void> {
  const updates: Partial<typeof identityBundles.$inferInsert> = {
    status: args.status,
  };

  if (args.policyVersion !== null) {
    updates.policyVersion = args.policyVersion;
  }
  if (args.issuerId !== null) {
    updates.issuerId = args.issuerId;
  }
  if (args.attestationExpiresAt !== null) {
    updates.attestationExpiresAt = args.attestationExpiresAt;
  }

  await db
    .update(identityBundles)
    .set({
      ...updates,
      updatedAt: sql`datetime('now')`,
    })
    .where(eq(identityBundles.userId, args.userId))
    .run();
}

export async function createIdentityDocument(
  data: Omit<IdentityDocument, "createdAt" | "updatedAt">
): Promise<void> {
  await db
    .insert(identityDocuments)
    .values({
      ...data,
    })
    .run();
}

export async function upsertIdentityDocument(
  data: Omit<IdentityDocument, "createdAt" | "updatedAt">
): Promise<void> {
  await db
    .insert(identityDocuments)
    .values({
      ...data,
    })
    .onConflictDoUpdate({
      target: identityDocuments.id,
      set: {
        userId: data.userId,
        documentType: data.documentType,
        issuerCountry: data.issuerCountry,
        documentHash: data.documentHash,
        nameCommitment: data.nameCommitment,
        verifiedAt: data.verifiedAt,
        confidenceScore: data.confidenceScore,
        status: data.status,
        updatedAt: sql`datetime('now')`,
      },
    })
    .run();
}
