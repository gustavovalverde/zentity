import type { ComplianceResult } from "@/lib/identity/verification/compliance";
import type {
  FheStatus,
  IdentityBundle,
  IdentityJobStatus,
  IdentityVerification,
  IdentityVerificationDraft,
  IdentityVerificationJob,
  NewIdentityVerification,
  ValidityStatus,
  ValidityTransitionSource,
} from "../schema/identity";

import { and, desc, eq, ne, sql } from "drizzle-orm";
// React.cache() is per-request memoization - NOT persistent across requests.
// Safe for shared computers: each HTTP request gets isolated cache scope.
import { cache } from "react";

import { POLICY_VERSION } from "@/lib/blockchain/attestation/policy";
import { computeFreshnessDeadline } from "@/lib/identity/validity/freshness";
import { recordValidityTransition } from "@/lib/identity/validity/transition";
import { deriveComplianceStatus } from "@/lib/identity/verification/compliance";

import { db } from "../connection";
import { pushSubscriptions } from "../schema/ciba";
import {
  attestationEvidence,
  identityBundles,
  identityValidityEvents,
  identityVerificationDrafts,
  identityVerificationJobs,
  identityVerifications,
} from "../schema/identity";
import {
  encryptedAttributes,
  encryptedSecrets,
  proofArtifacts,
  proofSessions,
  secretWrappers,
  signedClaims,
  zkChallenges,
} from "../schema/privacy";

export function isChipVerified(v: IdentityVerification | null): boolean {
  return v?.method === "nfc_chip" && v.status === "verified";
}

interface AccountIdentity {
  bundle: IdentityBundle | null;
  effectiveVerification: IdentityVerification | null;
  groupedCredentials: IdentityVerification[];
}

type IdentityExecutor = Pick<typeof db, "insert" | "select" | "update">;

function getInternalIdentityKey(
  verification: {
    dedupKey?: string | null | undefined;
    uniqueIdentifier?: string | null | undefined;
  } | null
): string | null {
  return verification?.dedupKey ?? verification?.uniqueIdentifier ?? null;
}

function deriveBundleValidityStatusFromVerifications(
  verifications: readonly IdentityVerification[]
): ValidityStatus {
  if (
    verifications.some((verification) => verification.status === "verified")
  ) {
    return "verified";
  }
  if (verifications.some((verification) => verification.status === "pending")) {
    return "pending";
  }
  if (verifications.some((verification) => verification.status === "failed")) {
    return "failed";
  }
  if (verifications.some((verification) => verification.status === "revoked")) {
    return "revoked";
  }
  return "pending";
}

async function loadIdentityBundleByUserId(
  userId: string,
  executor: IdentityExecutor = db
): Promise<IdentityBundle | null> {
  const row = await executor
    .select()
    .from(identityBundles)
    .where(eq(identityBundles.userId, userId))
    .limit(1)
    .get();

  return row ?? null;
}

async function getSignedClaimTypesForVerification(
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

/**
 * Check if user has a stored PROFILE encrypted secret with at least one wrapper.
 * The profile secret is the sole bridge between verified identity and deliverable
 * identity claims — without it, identity.* OAuth scopes cannot be fulfilled.
 */
export async function hasProfileSecret(userId: string): Promise<boolean> {
  const secret = await db
    .select({ id: encryptedSecrets.id })
    .from(encryptedSecrets)
    .where(
      and(
        eq(encryptedSecrets.userId, userId),
        eq(encryptedSecrets.secretType, "profile")
      )
    )
    .limit(1)
    .get();

  if (!secret) {
    return false;
  }

  const wrapper = await db
    .select({ id: secretWrappers.id })
    .from(secretWrappers)
    .where(eq(secretWrappers.secretId, secret.id))
    .limit(1)
    .get();

  return !!wrapper;
}

export async function getVerificationById(
  id: string,
  executor: IdentityExecutor = db
): Promise<IdentityVerification | null> {
  const row = await executor
    .select()
    .from(identityVerifications)
    .where(eq(identityVerifications.id, id))
    .get();
  return row ?? null;
}

export async function dedupKeyExistsForOtherUser(
  dedupKey: string,
  userId: string
): Promise<boolean> {
  const row = await db
    .select({ id: identityVerifications.id })
    .from(identityVerifications)
    .where(
      and(
        eq(identityVerifications.dedupKey, dedupKey),
        ne(identityVerifications.userId, userId),
        eq(identityVerifications.status, "verified")
      )
    )
    .get();

  return !!row;
}

export async function deleteIdentityData(userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .delete(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, userId))
      .run();
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
    await tx
      .delete(proofArtifacts)
      .where(eq(proofArtifacts.userId, userId))
      .run();
    await tx.delete(zkChallenges).where(eq(zkChallenges.userId, userId)).run();
    await tx
      .delete(proofSessions)
      .where(eq(proofSessions.userId, userId))
      .run();
    await tx
      .delete(identityVerificationJobs)
      .where(eq(identityVerificationJobs.userId, userId))
      .run();
    await tx
      .delete(identityVerificationDrafts)
      .where(eq(identityVerificationDrafts.userId, userId))
      .run();
    await tx
      .delete(identityValidityEvents)
      .where(eq(identityValidityEvents.userId, userId))
      .run();
    await tx
      .delete(identityVerifications)
      .where(eq(identityVerifications.userId, userId))
      .run();
    await tx
      .delete(identityBundles)
      .where(eq(identityBundles.userId, userId))
      .run();
  });
}

export const getComplianceStatus = cache(async function getComplianceStatus(
  userId: string
): Promise<ComplianceResult> {
  const accountIdentity = await getAccountIdentity(userId);
  const selectedVerification = accountIdentity.effectiveVerification;

  if (!selectedVerification) {
    return deriveComplianceStatus({
      verificationMethod: null,
      birthYearOffset: null,
      zkProofs: [],
      signedClaims: [],
      encryptedAttributes: [],
      hasUniqueIdentifier: false,
      hasNationalityCommitment: false,
    });
  }

  const verificationId = selectedVerification.id;

  // NFC chip path — only need signed claim types
  if (isChipVerified(selectedVerification)) {
    const claimTypes = await getSignedClaimTypesForVerification(
      userId,
      verificationId
    );
    return deriveComplianceStatus({
      verificationMethod: "nfc_chip",
      birthYearOffset: selectedVerification.birthYearOffset ?? null,
      zkProofs: [],
      signedClaims: claimTypes.map((t) => ({ claimType: t })),
      encryptedAttributes: [],
      hasUniqueIdentifier: Boolean(selectedVerification.uniqueIdentifier),
      hasNationalityCommitment: Boolean(
        selectedVerification.nationalityCommitment
      ),
    });
  }

  // OCR path — proofs and claims with session grouping
  const [sessionProofRows, signedClaimTypes] = await Promise.all([
    db
      .select({
        proofSessionId: proofArtifacts.proofSessionId,
        proofType: proofArtifacts.proofType,
        createdAt: proofArtifacts.createdAt,
      })
      .from(proofArtifacts)
      .where(
        and(
          eq(proofArtifacts.userId, userId),
          eq(proofArtifacts.verificationId, verificationId),
          eq(proofArtifacts.verified, true),
          eq(proofArtifacts.policyVersion, POLICY_VERSION),
          sql`${proofArtifacts.proofSessionId} is not null`
        )
      )
      .all(),
    getSignedClaimTypesForVerification(userId, verificationId),
  ]);

  // Group proofs by session, find the latest complete one
  const requiredProofs = [
    "age_verification",
    "doc_validity",
    "nationality_membership",
    "face_match",
    "identity_binding",
  ];
  const proofTypesBySession = new Map<
    string,
    { latestCreatedAt: string; types: Set<string> }
  >();
  for (const row of sessionProofRows) {
    if (!row.proofSessionId) {
      continue;
    }
    const current = proofTypesBySession.get(row.proofSessionId);
    if (!current) {
      proofTypesBySession.set(row.proofSessionId, {
        latestCreatedAt: row.createdAt,
        types: new Set([row.proofType]),
      });
      continue;
    }
    current.types.add(row.proofType);
    if (row.createdAt > current.latestCreatedAt) {
      current.latestCreatedAt = row.createdAt;
    }
  }

  let selectedSessionProofTypes: Set<string> = new Set();
  let latestCompleteSessionCreatedAt: string | null = null;
  for (const session of proofTypesBySession.values()) {
    const complete = requiredProofs.every((t) => session.types.has(t));
    if (!complete) {
      continue;
    }
    if (
      !latestCompleteSessionCreatedAt ||
      session.latestCreatedAt > latestCompleteSessionCreatedAt
    ) {
      latestCompleteSessionCreatedAt = session.latestCreatedAt;
      selectedSessionProofTypes = session.types;
    }
  }

  return deriveComplianceStatus({
    verificationMethod: "ocr",
    birthYearOffset: selectedVerification.birthYearOffset ?? null,
    zkProofs: [...selectedSessionProofTypes].map((proofType) => ({
      proofType,
      verified: true,
    })),
    signedClaims: signedClaimTypes.map((t) => ({ claimType: t })),
    encryptedAttributes: [],
    hasUniqueIdentifier: Boolean(
      selectedVerification.dedupKey || selectedVerification.uniqueIdentifier
    ),
    hasNationalityCommitment: Boolean(
      selectedVerification.nationalityCommitment
    ),
  });
});

export const getIdentityBundleByUserId = cache(
  async function getIdentityBundleByUserId(
    userId: string
  ): Promise<IdentityBundle | null> {
    return await loadIdentityBundleByUserId(userId);
  }
);

/**
 * Check if user has completed sign-up by verifying identity bundle exists.
 * The identity bundle is created during account creation (before FHE enrollment).
 */
export const hasCompletedSignUp = cache(async function hasCompletedSignUp(
  userId: string
): Promise<boolean> {
  const bundle = await getIdentityBundleByUserId(userId);
  return bundle !== null;
});

export const getLatestVerification = cache(async function getLatestVerification(
  userId: string
): Promise<IdentityVerification | null> {
  const row = await db
    .select()
    .from(identityVerifications)
    .where(
      and(
        eq(identityVerifications.userId, userId),
        ne(identityVerifications.status, "revoked")
      )
    )
    .orderBy(
      sql`CASE WHEN ${identityVerifications.verifiedAt} IS NULL THEN 1 ELSE 0 END`,
      desc(identityVerifications.verifiedAt),
      desc(identityVerifications.createdAt)
    )
    .limit(1)
    .get();

  return row ?? null;
});

async function getVerificationsByUserId(
  userId: string,
  executor: IdentityExecutor = db
): Promise<IdentityVerification[]> {
  return await executor
    .select()
    .from(identityVerifications)
    .where(eq(identityVerifications.userId, userId))
    .orderBy(
      sql`CASE WHEN ${identityVerifications.verifiedAt} IS NULL THEN 1 ELSE 0 END`,
      desc(identityVerifications.verifiedAt),
      desc(identityVerifications.createdAt)
    )
    .all();
}

async function selectEffectiveVerification(
  userId: string,
  verifications: readonly IdentityVerification[],
  executor: IdentityExecutor = db
): Promise<IdentityVerification | null> {
  if (verifications.length === 0) {
    return null;
  }

  for (const verification of verifications) {
    if (isChipVerified(verification)) {
      return verification;
    }
  }

  const [proofRows, claimRows] = await Promise.all([
    executor
      .select({
        verificationId: proofArtifacts.verificationId,
        proofSessionId: proofArtifacts.proofSessionId,
        proofType: proofArtifacts.proofType,
        policyVersion: proofArtifacts.policyVersion,
        verified: proofArtifacts.verified,
      })
      .from(proofArtifacts)
      .where(eq(proofArtifacts.userId, userId))
      .all(),
    executor
      .select({
        verificationId: signedClaims.verificationId,
        claimType: signedClaims.claimType,
      })
      .from(signedClaims)
      .where(eq(signedClaims.userId, userId))
      .all(),
  ]);

  const proofTypesByVerificationSession = new Map<
    string,
    Map<string, Set<string>>
  >();
  for (const row of proofRows) {
    if (
      !(
        row.verificationId &&
        row.proofSessionId &&
        row.verified &&
        row.policyVersion === POLICY_VERSION
      )
    ) {
      continue;
    }
    if (!proofTypesByVerificationSession.has(row.verificationId)) {
      proofTypesByVerificationSession.set(row.verificationId, new Map());
    }
    const sessionProofs =
      proofTypesByVerificationSession.get(row.verificationId) ?? new Map();
    if (!sessionProofs.has(row.proofSessionId)) {
      sessionProofs.set(row.proofSessionId, new Set());
    }
    sessionProofs.get(row.proofSessionId)?.add(row.proofType);
    proofTypesByVerificationSession.set(row.verificationId, sessionProofs);
  }

  const claimTypesByVerification = new Map<string, Set<string>>();
  for (const row of claimRows) {
    if (!row.verificationId) {
      continue;
    }
    if (!claimTypesByVerification.has(row.verificationId)) {
      claimTypesByVerification.set(row.verificationId, new Set());
    }
    claimTypesByVerification.get(row.verificationId)?.add(row.claimType);
  }

  const requiredProofs = [
    "age_verification",
    "doc_validity",
    "nationality_membership",
    "face_match",
    "identity_binding",
  ];
  const requiredClaims = ["ocr_result", "liveness_score", "face_match_score"];

  const hasAll = (set: Set<string> | undefined, required: string[]) =>
    required.every((item) => set?.has(item));

  for (const verification of verifications) {
    if (verification.status !== "verified") {
      continue;
    }
    const proofSessions = proofTypesByVerificationSession.get(verification.id);
    const hasCompleteProofSession = Boolean(
      proofSessions &&
        [...proofSessions.values()].some((proofs) =>
          hasAll(proofs, requiredProofs)
        )
    );
    const claims = claimTypesByVerification.get(verification.id);
    if (hasCompleteProofSession && hasAll(claims, requiredClaims)) {
      return verification;
    }
  }

  for (const verification of verifications) {
    if (verification.status === "verified") {
      return verification;
    }
  }

  return (
    verifications.find((verification) => verification.status !== "revoked") ??
    null
  );
}

function getEffectiveVerificationFromBundle(
  bundle: IdentityBundle | null,
  verifications: readonly IdentityVerification[]
): IdentityVerification | null {
  if (!bundle?.effectiveVerificationId) {
    return null;
  }

  return (
    verifications.find(
      (verification) => verification.id === bundle.effectiveVerificationId
    ) ?? null
  );
}

export const getAccountIdentity = cache(async function getAccountIdentity(
  userId: string
): Promise<AccountIdentity> {
  const [bundle, groupedCredentials] = await Promise.all([
    loadIdentityBundleByUserId(userId),
    getVerificationsByUserId(userId),
  ]);

  if (!bundle && groupedCredentials.length === 0) {
    return {
      bundle: null,
      effectiveVerification: null,
      groupedCredentials: [],
    };
  }

  return {
    bundle,
    effectiveVerification: getEffectiveVerificationFromBundle(
      bundle,
      groupedCredentials
    ),
    groupedCredentials,
  };
});

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

export async function deleteIdentityDraft(draftId: string): Promise<void> {
  await db
    .delete(identityVerificationDrafts)
    .where(eq(identityVerificationDrafts.id, draftId))
    .run();
}

export async function upsertIdentityDraft(
  data: Partial<IdentityVerificationDraft> & {
    id: string;
    userId: string;
    verificationId: string;
  }
): Promise<IdentityVerificationDraft> {
  const now = new Date().toISOString();
  await db
    .insert(identityVerificationDrafts)
    .values({
      id: data.id,
      userId: data.userId,
      verificationId: data.verificationId,
      documentProcessed: data.documentProcessed ?? false,
      isDocumentValid: data.isDocumentValid ?? false,
      isDuplicateDocument: data.isDuplicateDocument ?? false,
      documentHashField: data.documentHashField ?? null,
      ageClaimHash: data.ageClaimHash ?? null,
      docValidityClaimHash: data.docValidityClaimHash ?? null,
      nationalityClaimHash: data.nationalityClaimHash ?? null,
      ocrIssues: data.ocrIssues ?? null,
      antispoofScore: data.antispoofScore ?? null,
      liveScore: data.liveScore ?? null,
      faceMatchConfidence: data.faceMatchConfidence ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: identityVerificationDrafts.id,
      set: {
        userId: data.userId,
        verificationId: data.verificationId,
        documentProcessed: data.documentProcessed ?? false,
        isDocumentValid: data.isDocumentValid ?? false,
        isDuplicateDocument: data.isDuplicateDocument ?? false,
        documentHashField: data.documentHashField ?? null,
        ageClaimHash: data.ageClaimHash ?? null,
        docValidityClaimHash: data.docValidityClaimHash ?? null,
        nationalityClaimHash: data.nationalityClaimHash ?? null,
        ocrIssues: data.ocrIssues ?? null,
        antispoofScore: data.antispoofScore ?? null,
        liveScore: data.liveScore ?? null,
        faceMatchConfidence: data.faceMatchConfidence ?? null,
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
  verificationId?: string | null;
  userId: string;
  fheKeyId?: string | null;
}): Promise<void> {
  await db
    .insert(identityVerificationJobs)
    .values({
      id: args.id,
      draftId: args.draftId,
      verificationId: args.verificationId ?? null,
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

export async function upsertIdentityBundle(
  data: {
    attestationExpiresAt?: string | null;
    effectiveVerificationId?: string | null;
    fheError?: string | null;
    fheKeyId?: string | null;
    fheStatus?: FheStatus | null;
    freshnessCheckedAt?: string | null;
    issuerId?: string | null;
    lastVerifiedAt?: string | null;
    policyVersion?: string | null;
    revokedAt?: string | null;
    revokedBy?: string | null;
    revokedReason?: string | null;
    rpNullifierSeed?: string | null;
    verificationExpiresAt?: string | null;
    userId: string;
    validityStatus?: ValidityStatus;
    verificationCount?: number;
    walletAddress?: string | null;
  },
  executor: IdentityExecutor = db
): Promise<void> {
  const insertValues: typeof identityBundles.$inferInsert = {
    userId: data.userId,
    effectiveVerificationId: data.effectiveVerificationId ?? null,
    rpNullifierSeed: data.rpNullifierSeed ?? null,
    walletAddress: data.walletAddress ?? null,
    validityStatus: data.validityStatus ?? "pending",
    policyVersion: data.policyVersion ?? null,
    issuerId: data.issuerId ?? null,
    attestationExpiresAt: data.attestationExpiresAt ?? null,
    fheKeyId: data.fheKeyId ?? null,
    fheStatus: data.fheStatus ?? null,
    fheError: data.fheError ?? null,
    revokedAt: data.revokedAt ?? null,
    revokedBy: data.revokedBy ?? null,
    revokedReason: data.revokedReason ?? null,
    lastVerifiedAt: data.lastVerifiedAt ?? null,
    verificationExpiresAt: data.verificationExpiresAt ?? null,
    freshnessCheckedAt: data.freshnessCheckedAt ?? null,
    verificationCount: data.verificationCount ?? 0,
  };

  const updateSet: Record<string, unknown> = {
    updatedAt: sql`datetime('now')`,
  };

  if (data.effectiveVerificationId !== undefined) {
    updateSet.effectiveVerificationId = data.effectiveVerificationId;
  }
  if (data.rpNullifierSeed !== undefined) {
    updateSet.rpNullifierSeed = data.rpNullifierSeed;
  }
  if (data.walletAddress !== undefined) {
    updateSet.walletAddress = data.walletAddress;
  }
  if (data.validityStatus !== undefined) {
    updateSet.validityStatus = data.validityStatus;
  }
  if (data.policyVersion !== undefined) {
    updateSet.policyVersion = data.policyVersion;
  }
  if (data.issuerId !== undefined) {
    updateSet.issuerId = data.issuerId;
  }
  if (data.attestationExpiresAt !== undefined) {
    updateSet.attestationExpiresAt = data.attestationExpiresAt;
  }
  if (data.fheKeyId !== undefined) {
    updateSet.fheKeyId = data.fheKeyId;
  }
  if (data.fheStatus !== undefined) {
    updateSet.fheStatus = data.fheStatus;
  }
  if (data.fheError !== undefined) {
    updateSet.fheError = data.fheError;
  }
  if (data.revokedAt !== undefined) {
    updateSet.revokedAt = data.revokedAt;
  }
  if (data.revokedBy !== undefined) {
    updateSet.revokedBy = data.revokedBy;
  }
  if (data.revokedReason !== undefined) {
    updateSet.revokedReason = data.revokedReason;
  }
  if (data.lastVerifiedAt !== undefined) {
    updateSet.lastVerifiedAt = data.lastVerifiedAt;
  }
  if (data.verificationExpiresAt !== undefined) {
    updateSet.verificationExpiresAt = data.verificationExpiresAt;
  }
  if (data.freshnessCheckedAt !== undefined) {
    updateSet.freshnessCheckedAt = data.freshnessCheckedAt;
  }
  if (data.verificationCount !== undefined) {
    updateSet.verificationCount = data.verificationCount;
  }

  await executor
    .insert(identityBundles)
    .values(insertValues)
    .onConflictDoUpdate({
      target: identityBundles.userId,
      set: updateSet,
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

export async function updateIdentityBundleAttestationState(args: {
  userId: string;
  policyVersion?: string | null;
  issuerId?: string | null;
  attestationExpiresAt?: string | null;
}): Promise<void> {
  const updates: Partial<typeof identityBundles.$inferInsert> = {};

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

export async function createVerification(
  data: Omit<NewIdentityVerification, "createdAt" | "updatedAt">,
  executor: IdentityExecutor = db
): Promise<void> {
  await executor.insert(identityVerifications).values(data).run();
}

export async function upsertVerification(
  data: Omit<NewIdentityVerification, "createdAt" | "updatedAt">,
  executor: IdentityExecutor = db
): Promise<void> {
  const { id: _id, ...updateFields } = data;
  await executor
    .insert(identityVerifications)
    .values(data)
    .onConflictDoUpdate({
      target: identityVerifications.id,
      set: {
        ...updateFields,
        updatedAt: sql`datetime('now')`,
      },
    })
    .run();
}

function resolveBundleValidityStatus(args: {
  bundle: IdentityBundle | null;
  derivedValidityStatus: ValidityStatus;
  nextEffectiveVerificationId: string | null;
}): ValidityStatus {
  const currentValidityStatus = args.bundle?.validityStatus ?? null;

  if (
    !(currentValidityStatus === "revoked" || currentValidityStatus === "stale")
  ) {
    return args.derivedValidityStatus;
  }

  const effectiveVerificationChanged =
    (args.bundle?.effectiveVerificationId ?? null) !==
    args.nextEffectiveVerificationId;

  if (
    args.derivedValidityStatus === "verified" &&
    effectiveVerificationChanged
  ) {
    return "verified";
  }

  return currentValidityStatus;
}

async function markSupersededVerifications(
  args: {
    occurredAt: string;
    userId: string;
    verificationId: string;
  },
  executor: IdentityExecutor = db
): Promise<void> {
  await executor
    .update(identityVerifications)
    .set({
      supersededAt: args.occurredAt,
      supersededByVerificationId: args.verificationId,
      updatedAt: args.occurredAt,
    })
    .where(
      and(
        eq(identityVerifications.userId, args.userId),
        eq(identityVerifications.status, "verified"),
        ne(identityVerifications.id, args.verificationId)
      )
    )
    .run();

  await executor
    .update(identityVerifications)
    .set({
      supersededAt: null,
      supersededByVerificationId: null,
      updatedAt: args.occurredAt,
    })
    .where(eq(identityVerifications.id, args.verificationId))
    .run();
}

export async function reconcileIdentityBundle(
  userId: string,
  executor: IdentityExecutor = db
): Promise<{
  changed: boolean;
  credentialSuperseded: boolean;
  effectiveVerification: IdentityVerification | null;
  effectiveVerificationId: string | null;
  verificationExpiresAt: string | null;
  previousEffectiveVerificationId: string | null;
  previousValidityStatus: ValidityStatus | null;
  validityStatus: ValidityStatus;
}> {
  const occurredAt = new Date().toISOString();
  const [bundle, verifications] = await Promise.all([
    loadIdentityBundleByUserId(userId, executor),
    getVerificationsByUserId(userId, executor),
  ]);

  if (!bundle && verifications.length === 0) {
    return {
      changed: false,
      credentialSuperseded: false,
      effectiveVerification: null,
      effectiveVerificationId: null,
      verificationExpiresAt: null,
      previousEffectiveVerificationId: null,
      previousValidityStatus: null,
      validityStatus: "pending",
    };
  }

  const effectiveVerification = await selectEffectiveVerification(
    userId,
    verifications,
    executor
  );
  const previousEffectiveVerificationId =
    bundle?.effectiveVerificationId ?? null;
  const nextEffectiveVerificationId = effectiveVerification?.id ?? null;
  const nextRpNullifierSeed =
    bundle?.rpNullifierSeed ??
    getInternalIdentityKey(effectiveVerification) ??
    null;
  const derivedValidityStatus =
    deriveBundleValidityStatusFromVerifications(verifications);
  const nextValidityStatus = resolveBundleValidityStatus({
    bundle,
    derivedValidityStatus,
    nextEffectiveVerificationId,
  });
  const nextLastVerifiedAt = effectiveVerification?.verifiedAt ?? null;
  const nextVerificationExpiresAt =
    effectiveVerification?.verifiedAt && effectiveVerification?.method
      ? computeFreshnessDeadline({
          method: effectiveVerification.method,
          verifiedAt: effectiveVerification.verifiedAt,
        })
      : null;
  const shouldRefreshFreshnessCheck =
    (bundle?.effectiveVerificationId ?? null) !== nextEffectiveVerificationId ||
    (bundle?.lastVerifiedAt ?? null) !== nextLastVerifiedAt ||
    (bundle?.validityStatus ?? null) !== nextValidityStatus;
  let nextFreshnessCheckedAt: string | null = null;
  if (effectiveVerification) {
    nextFreshnessCheckedAt = shouldRefreshFreshnessCheck
      ? occurredAt
      : (bundle?.freshnessCheckedAt ?? occurredAt);
  }
  const shouldIncrementVerificationCount =
    Boolean(effectiveVerification?.verifiedAt) &&
    (bundle?.lastVerifiedAt ?? null) !== nextLastVerifiedAt;
  const nextVerificationCount = shouldIncrementVerificationCount
    ? (bundle?.verificationCount ?? 0) + 1
    : (bundle?.verificationCount ?? 0);
  const shouldClearRevocationMetadata =
    nextValidityStatus !== "revoked" &&
    Boolean(bundle?.revokedAt || bundle?.revokedBy || bundle?.revokedReason);

  const shouldCreateBundle = !bundle;
  const shouldSyncEffectiveVerification =
    (bundle?.effectiveVerificationId ?? null) !== nextEffectiveVerificationId;
  const shouldSeedRpNullifier =
    !bundle?.rpNullifierSeed && Boolean(nextRpNullifierSeed);
  const shouldSyncValidityStatus =
    (bundle?.validityStatus ?? null) !== nextValidityStatus;
  const shouldSyncFreshness =
    (bundle?.lastVerifiedAt ?? null) !== nextLastVerifiedAt ||
    (bundle?.verificationExpiresAt ?? null) !== nextVerificationExpiresAt ||
    (bundle?.freshnessCheckedAt ?? null) !== nextFreshnessCheckedAt;
  const shouldSyncVerificationCount =
    (bundle?.verificationCount ?? 0) !== nextVerificationCount;
  const credentialSuperseded = Boolean(
    previousEffectiveVerificationId &&
      nextEffectiveVerificationId &&
      previousEffectiveVerificationId !== nextEffectiveVerificationId &&
      effectiveVerification?.status === "verified"
  );

  if (
    !(
      shouldCreateBundle ||
      shouldSyncEffectiveVerification ||
      shouldSeedRpNullifier ||
      shouldSyncValidityStatus ||
      shouldSyncFreshness ||
      shouldSyncVerificationCount ||
      shouldClearRevocationMetadata
    )
  ) {
    return {
      changed: false,
      credentialSuperseded,
      effectiveVerification,
      effectiveVerificationId: nextEffectiveVerificationId,
      verificationExpiresAt: nextVerificationExpiresAt,
      previousEffectiveVerificationId,
      previousValidityStatus: bundle?.validityStatus ?? null,
      validityStatus: nextValidityStatus,
    };
  }

  if (credentialSuperseded && nextEffectiveVerificationId) {
    await markSupersededVerifications(
      {
        occurredAt,
        userId,
        verificationId: nextEffectiveVerificationId,
      },
      executor
    );
  }

  await upsertIdentityBundle(
    {
      userId,
      validityStatus: nextValidityStatus,
      effectiveVerificationId: nextEffectiveVerificationId,
      lastVerifiedAt: nextLastVerifiedAt,
      verificationExpiresAt: nextVerificationExpiresAt,
      freshnessCheckedAt: nextFreshnessCheckedAt,
      verificationCount: nextVerificationCount,
      ...(nextRpNullifierSeed ? { rpNullifierSeed: nextRpNullifierSeed } : {}),
      ...(shouldClearRevocationMetadata
        ? {
            revokedAt: null,
            revokedBy: null,
            revokedReason: null,
          }
        : {}),
    },
    executor
  );

  return {
    changed: true,
    credentialSuperseded,
    effectiveVerification,
    effectiveVerificationId: nextEffectiveVerificationId,
    verificationExpiresAt: nextVerificationExpiresAt,
    previousEffectiveVerificationId,
    previousValidityStatus: bundle?.validityStatus ?? null,
    validityStatus: nextValidityStatus,
  };
}

export const getRpNullifierSeed = cache(async function getRpNullifierSeed(
  userId: string
): Promise<string | null> {
  const bundle = await getIdentityBundleByUserId(userId);
  if (bundle?.rpNullifierSeed) {
    return bundle.rpNullifierSeed;
  }

  const verifications = await getVerificationsByUserId(userId);
  return (
    getInternalIdentityKey(
      verifications.find(
        (verification) => verification.status === "verified"
      ) ?? null
    ) ?? null
  );
});

/**
 * Check if a nullifier is already used by a different user.
 * Same passport cannot register on multiple accounts.
 */
export async function isNullifierUsedByOtherUser(
  uniqueIdentifier: string,
  userId: string
): Promise<boolean> {
  const row = await db
    .select({ id: identityVerifications.id })
    .from(identityVerifications)
    .where(
      and(
        eq(identityVerifications.uniqueIdentifier, uniqueIdentifier),
        eq(identityVerifications.status, "verified"),
        ne(identityVerifications.userId, userId)
      )
    )
    .get();
  return !!row;
}

/**
 * Cascading identity revocation.
 *
 * Steps 1-3 (verification, bundle, OID4VCI credentials) execute in a single
 * transaction. Step 4 (on-chain attestation) is best-effort — failures are
 * logged but don't roll back the DB revocation.
 */
export async function revokeIdentity(
  userId: string,
  revokedBy: string,
  reason: string,
  source: ValidityTransitionSource
): Promise<{
  eventId: string | null;
  revokedVerifications: number;
  scheduledDeliveries: number;
}> {
  const now = new Date().toISOString();
  let eventId: string | null = null;
  let revokedVerifications = 0;
  let scheduledDeliveries = 0;

  await db.transaction(async (tx) => {
    const currentBundle =
      (await tx
        .select()
        .from(identityBundles)
        .where(eq(identityBundles.userId, userId))
        .limit(1)
        .get()) ?? null;

    // Step 1: Revoke all active verifications
    const verificationResult = await tx
      .update(identityVerifications)
      .set({
        status: "revoked",
        revokedAt: now,
        revokedBy,
        revokedReason: reason,
        updatedAt: now,
      })
      .where(
        and(
          eq(identityVerifications.userId, userId),
          ne(identityVerifications.status, "revoked")
        )
      )
      .run();
    revokedVerifications = verificationResult.rowsAffected;

    // Step 2: Clear selected credential state on the identity bundle
    let shouldRecordRevocation = false;
    if (currentBundle) {
      const bundleResult = await tx
        .update(identityBundles)
        .set({
          effectiveVerificationId: null,
          rpNullifierSeed: null,
          updatedAt: now,
        })
        .where(eq(identityBundles.userId, userId))
        .run();
      shouldRecordRevocation =
        bundleResult.rowsAffected > 0 &&
        currentBundle.validityStatus !== "revoked";
    } else {
      shouldRecordRevocation = verificationResult.rowsAffected > 0;
    }

    if (shouldRecordRevocation || verificationResult.rowsAffected > 0) {
      const { event, deliveries } = await recordValidityTransition({
        executor: tx,
        userId,
        verificationId: currentBundle?.effectiveVerificationId ?? null,
        eventKind: "revoked",
        source,
        triggeredBy: revokedBy,
        reason,
        occurredAt: now,
        bundleSnapshot: {
          validityStatus: "revoked",
          revokedAt: now,
          revokedBy,
          revokedReason: reason,
        },
      });
      eventId = event.id;
      scheduledDeliveries = deliveries.length;
    }
  });

  return { eventId, revokedVerifications, scheduledDeliveries };
}
