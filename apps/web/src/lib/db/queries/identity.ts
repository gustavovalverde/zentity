import type {
  FheStatus,
  IdentityBundle,
  IdentityBundleStatus,
  IdentityDocument,
  IdentityJobStatus,
  IdentityVerificationDraft,
  IdentityVerificationJob,
} from "../schema";

import { desc, eq, sql } from "drizzle-orm";

import { decryptFirstName } from "../../crypto/pii-encryption";
import { db } from "../connection";
import {
  attestationEvidence,
  encryptedAttributes,
  encryptedSecrets,
  identityBundles,
  identityDocuments,
  identityVerificationDrafts,
  identityVerificationJobs,
  secretWrappers,
  signedClaims,
  zkProofs,
} from "../schema";
import {
  getSignedClaimTypesByUserAndDocument,
  getZkProofTypesByUserAndDocument,
} from "./crypto";

export function documentHashExists(documentHash: string): boolean {
  const row = db
    .select({ id: identityDocuments.id })
    .from(identityDocuments)
    .where(eq(identityDocuments.documentHash, documentHash))
    .get();

  return !!row;
}

export function deleteIdentityData(userId: string): void {
  db.transaction((tx) => {
    tx.delete(attestationEvidence)
      .where(eq(attestationEvidence.userId, userId))
      .run();
    tx.delete(signedClaims).where(eq(signedClaims.userId, userId)).run();
    tx.delete(encryptedAttributes)
      .where(eq(encryptedAttributes.userId, userId))
      .run();
    tx.delete(secretWrappers).where(eq(secretWrappers.userId, userId)).run();
    tx.delete(encryptedSecrets)
      .where(eq(encryptedSecrets.userId, userId))
      .run();
    tx.delete(zkProofs).where(eq(zkProofs.userId, userId)).run();
    tx.delete(identityVerificationJobs)
      .where(eq(identityVerificationJobs.userId, userId))
      .run();
    tx.delete(identityVerificationDrafts)
      .where(eq(identityVerificationDrafts.userId, userId))
      .run();
    tx.delete(identityDocuments)
      .where(eq(identityDocuments.userId, userId))
      .run();
    tx.delete(identityBundles).where(eq(identityBundles.userId, userId)).run();
  });
}

export function getVerificationStatus(userId: string): {
  verified: boolean;
  level: "none" | "basic" | "full";
  checks: {
    document: boolean;
    liveness: boolean;
    ageProof: boolean;
    docValidityProof: boolean;
    nationalityProof: boolean;
    faceMatchProof: boolean;
  };
} {
  const selectedDocument = getSelectedIdentityDocumentByUserId(userId);
  const documentId = selectedDocument?.id ?? null;
  const zkProofTypes = documentId
    ? getZkProofTypesByUserAndDocument(userId, documentId)
    : [];
  const signedClaimTypes = documentId
    ? getSignedClaimTypesByUserAndDocument(userId, documentId)
    : [];

  const checks = {
    document: selectedDocument?.status === "verified",
    liveness: signedClaimTypes.includes("liveness_score"),
    ageProof: zkProofTypes.includes("age_verification"),
    docValidityProof: zkProofTypes.includes("doc_validity"),
    nationalityProof: zkProofTypes.includes("nationality_membership"),
    faceMatchProof: zkProofTypes.includes("face_match"),
  };

  const passedChecks = Object.values(checks).filter(Boolean).length;
  const totalChecks = Object.values(checks).length;

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
}

export function getIdentityBundleByUserId(
  userId: string,
): IdentityBundle | null {
  const row = db
    .select()
    .from(identityBundles)
    .where(eq(identityBundles.userId, userId))
    .limit(1)
    .get();

  return row ?? null;
}

export function getLatestIdentityDocumentByUserId(
  userId: string,
): IdentityDocument | null {
  const row = db
    .select()
    .from(identityDocuments)
    .where(eq(identityDocuments.userId, userId))
    .orderBy(
      sql`CASE WHEN ${identityDocuments.verifiedAt} IS NULL THEN 1 ELSE 0 END`,
      desc(identityDocuments.verifiedAt),
      desc(identityDocuments.createdAt),
    )
    .limit(1)
    .get();

  return row ?? null;
}

export function getIdentityDocumentsByUserId(
  userId: string,
): IdentityDocument[] {
  return db
    .select()
    .from(identityDocuments)
    .where(eq(identityDocuments.userId, userId))
    .orderBy(
      sql`CASE WHEN ${identityDocuments.verifiedAt} IS NULL THEN 1 ELSE 0 END`,
      desc(identityDocuments.verifiedAt),
      desc(identityDocuments.createdAt),
    )
    .all();
}

export function getSelectedIdentityDocumentByUserId(
  userId: string,
): IdentityDocument | null {
  const documents = getIdentityDocumentsByUserId(userId);
  if (documents.length === 0) return null;

  const proofRows = db
    .select({
      documentId: zkProofs.documentId,
      proofType: zkProofs.proofType,
      verified: zkProofs.verified,
    })
    .from(zkProofs)
    .where(eq(zkProofs.userId, userId))
    .all();

  const claimRows = db
    .select({
      documentId: signedClaims.documentId,
      claimType: signedClaims.claimType,
    })
    .from(signedClaims)
    .where(eq(signedClaims.userId, userId))
    .all();

  const proofTypesByDocument = new Map<string, Set<string>>();
  for (const row of proofRows) {
    if (!row.documentId || !row.verified) continue;
    if (!proofTypesByDocument.has(row.documentId)) {
      proofTypesByDocument.set(row.documentId, new Set());
    }
    proofTypesByDocument.get(row.documentId)?.add(row.proofType);
  }

  const claimTypesByDocument = new Map<string, Set<string>>();
  for (const row of claimRows) {
    if (!row.documentId) continue;
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
    if (doc.status !== "verified") continue;
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

export function getIdentityDraftById(
  draftId: string,
): IdentityVerificationDraft | null {
  const row = db
    .select()
    .from(identityVerificationDrafts)
    .where(eq(identityVerificationDrafts.id, draftId))
    .limit(1)
    .get();

  return row ?? null;
}

export function getIdentityDraftBySessionId(
  sessionId: string,
): IdentityVerificationDraft | null {
  const row = db
    .select()
    .from(identityVerificationDrafts)
    .where(eq(identityVerificationDrafts.onboardingSessionId, sessionId))
    .orderBy(desc(identityVerificationDrafts.updatedAt))
    .limit(1)
    .get();

  return row ?? null;
}

export function upsertIdentityDraft(
  data: Partial<IdentityVerificationDraft> & {
    id: string;
    onboardingSessionId: string;
    documentId: string;
  },
): IdentityVerificationDraft {
  const now = new Date().toISOString();
  db.insert(identityVerificationDrafts)
    .values({
      id: data.id,
      onboardingSessionId: data.onboardingSessionId,
      userId: data.userId ?? null,
      documentId: data.documentId,
      documentProcessed: data.documentProcessed ?? false,
      isDocumentValid: data.isDocumentValid ?? false,
      isDuplicateDocument: data.isDuplicateDocument ?? false,
      documentType: data.documentType ?? null,
      issuerCountry: data.issuerCountry ?? null,
      documentHash: data.documentHash ?? null,
      documentHashField: data.documentHashField ?? null,
      nameCommitment: data.nameCommitment ?? null,
      userSalt: data.userSalt ?? null,
      birthYear: data.birthYear ?? null,
      birthYearOffset: data.birthYearOffset ?? null,
      expiryDateInt: data.expiryDateInt ?? null,
      nationalityCode: data.nationalityCode ?? null,
      nationalityCodeNumeric: data.nationalityCodeNumeric ?? null,
      countryCodeNumeric: data.countryCodeNumeric ?? null,
      confidenceScore: data.confidenceScore ?? null,
      firstNameEncrypted: data.firstNameEncrypted ?? null,
      ocrIssues: data.ocrIssues ?? null,
      antispoofScore: data.antispoofScore ?? null,
      liveScore: data.liveScore ?? null,
      livenessPassed: data.livenessPassed ?? null,
      faceMatchConfidence: data.faceMatchConfidence ?? null,
      faceMatchPassed: data.faceMatchPassed ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: identityVerificationDrafts.id,
      set: {
        userId: data.userId ?? null,
        documentId: data.documentId,
        documentProcessed: data.documentProcessed ?? false,
        isDocumentValid: data.isDocumentValid ?? false,
        isDuplicateDocument: data.isDuplicateDocument ?? false,
        documentType: data.documentType ?? null,
        issuerCountry: data.issuerCountry ?? null,
        documentHash: data.documentHash ?? null,
        documentHashField: data.documentHashField ?? null,
        nameCommitment: data.nameCommitment ?? null,
        userSalt: data.userSalt ?? null,
        birthYear: data.birthYear ?? null,
        birthYearOffset: data.birthYearOffset ?? null,
        expiryDateInt: data.expiryDateInt ?? null,
        nationalityCode: data.nationalityCode ?? null,
        nationalityCodeNumeric: data.nationalityCodeNumeric ?? null,
        countryCodeNumeric: data.countryCodeNumeric ?? null,
        confidenceScore: data.confidenceScore ?? null,
        firstNameEncrypted: data.firstNameEncrypted ?? null,
        ocrIssues: data.ocrIssues ?? null,
        antispoofScore: data.antispoofScore ?? null,
        liveScore: data.liveScore ?? null,
        livenessPassed: data.livenessPassed ?? null,
        faceMatchConfidence: data.faceMatchConfidence ?? null,
        faceMatchPassed: data.faceMatchPassed ?? null,
        updatedAt: sql`datetime('now')`,
      },
    })
    .run();

  const updated = getIdentityDraftById(data.id);
  if (!updated) {
    throw new Error("Failed to upsert identity draft");
  }
  return updated;
}

export function updateIdentityDraft(
  draftId: string,
  updates: Partial<IdentityVerificationDraft>,
): void {
  db.update(identityVerificationDrafts)
    .set({
      ...updates,
      updatedAt: sql`datetime('now')`,
    })
    .where(eq(identityVerificationDrafts.id, draftId))
    .run();
}

export function getIdentityVerificationJobById(
  jobId: string,
): IdentityVerificationJob | null {
  const row = db
    .select()
    .from(identityVerificationJobs)
    .where(eq(identityVerificationJobs.id, jobId))
    .limit(1)
    .get();

  return row ?? null;
}

export function getLatestIdentityVerificationJobForDraft(
  draftId: string,
): IdentityVerificationJob | null {
  const row = db
    .select()
    .from(identityVerificationJobs)
    .where(eq(identityVerificationJobs.draftId, draftId))
    .orderBy(desc(identityVerificationJobs.createdAt))
    .limit(1)
    .get();

  return row ?? null;
}

export function createIdentityVerificationJob(args: {
  id: string;
  draftId: string;
  userId: string;
  fheKeyId?: string | null;
  fhePublicKey?: string | null;
}): void {
  db.insert(identityVerificationJobs)
    .values({
      id: args.id,
      draftId: args.draftId,
      userId: args.userId,
      status: "queued",
      fheKeyId: args.fheKeyId ?? null,
      fhePublicKey: args.fhePublicKey ?? null,
      attempts: 0,
    })
    .run();
}

export function updateIdentityVerificationJobStatus(args: {
  jobId: string;
  status: IdentityJobStatus;
  error?: string | null;
  result?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  attempts?: number;
}): void {
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

  db.update(identityVerificationJobs)
    .set({ ...updates, updatedAt: sql`datetime('now')` })
    .where(eq(identityVerificationJobs.id, args.jobId))
    .run();
}

export function upsertIdentityBundle(data: {
  userId: string;
  walletAddress?: string | null;
  status?: IdentityBundleStatus;
  policyVersion?: string | null;
  issuerId?: string | null;
  attestationExpiresAt?: string | null;
  fheKeyId?: string | null;
  fhePublicKey?: string | null;
  fheStatus?: FheStatus | null;
  fheError?: string | null;
}): void {
  db.insert(identityBundles)
    .values({
      userId: data.userId,
      walletAddress: data.walletAddress ?? null,
      status: data.status ?? "pending",
      policyVersion: data.policyVersion ?? null,
      issuerId: data.issuerId ?? null,
      attestationExpiresAt: data.attestationExpiresAt ?? null,
      fheKeyId: data.fheKeyId ?? null,
      fhePublicKey: data.fhePublicKey ?? null,
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
        fhePublicKey: data.fhePublicKey ?? null,
        fheStatus: data.fheStatus ?? null,
        fheError: data.fheError ?? null,
        updatedAt: sql`datetime('now')`,
      },
    })
    .run();
}

export function updateIdentityBundleStatus(args: {
  userId: string;
  status: IdentityBundleStatus;
  policyVersion?: string | null;
  issuerId?: string | null;
  attestationExpiresAt?: string | null;
}): void {
  const updates: Partial<typeof identityBundles.$inferInsert> = {
    status: args.status,
  };

  if (args.policyVersion != null) {
    updates.policyVersion = args.policyVersion;
  }
  if (args.issuerId != null) {
    updates.issuerId = args.issuerId;
  }
  if (args.attestationExpiresAt != null) {
    updates.attestationExpiresAt = args.attestationExpiresAt;
  }

  db.update(identityBundles)
    .set({
      ...updates,
      updatedAt: sql`datetime('now')`,
    })
    .where(eq(identityBundles.userId, args.userId))
    .run();
}

export function createIdentityDocument(
  data: Omit<IdentityDocument, "createdAt" | "updatedAt">,
): void {
  db.insert(identityDocuments)
    .values({
      ...data,
    })
    .run();
}

export async function getUserFirstName(userId: string): Promise<string | null> {
  const document = getSelectedIdentityDocumentByUserId(userId);
  if (!document?.firstNameEncrypted) return null;

  return decryptFirstName(document.firstNameEncrypted);
}
