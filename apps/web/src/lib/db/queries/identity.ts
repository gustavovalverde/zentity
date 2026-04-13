import type { ComplianceResult } from "@/lib/identity/verification/compliance";
import type {
  FheStatus,
  IdentityBundle,
  IdentityBundleStatus,
  IdentityJobStatus,
  IdentityVerification,
  IdentityVerificationDraft,
  IdentityVerificationJob,
  NewIdentityVerification,
} from "../schema/identity";

import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
// React.cache() is per-request memoization - NOT persistent across requests.
// Safe for shared computers: each HTTP request gets isolated cache scope.
import { cache } from "react";

import { POLICY_VERSION } from "@/lib/blockchain/attestation/policy";
import {
  canCreateProvider,
  createProvider,
} from "@/lib/blockchain/attestation/providers";
import { deriveComplianceStatus } from "@/lib/identity/verification/compliance";

import { db } from "../connection";
import { pushSubscriptions } from "../schema/ciba";
import {
  attestationEvidence,
  blockchainAttestations,
  identityBundles,
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
import { getSignedClaimTypesByUserAndVerification } from "./privacy";

export function isChipVerified(v: IdentityVerification | null): boolean {
  return v?.method === "nfc_chip" && v.status === "verified";
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
  id: string
): Promise<IdentityVerification | null> {
  const row = await db
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
      .delete(identityVerifications)
      .where(eq(identityVerifications.userId, userId))
      .run();
    await tx
      .delete(identityBundles)
      .where(eq(identityBundles.userId, userId))
      .run();
  });
}

export const getVerificationStatus = cache(async function getVerificationStatus(
  userId: string
): Promise<ComplianceResult> {
  const selectedVerification = await getSelectedVerification(userId);

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
    const claimTypes = await getSignedClaimTypesByUserAndVerification(
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
    getSignedClaimTypesByUserAndVerification(userId, verificationId),
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
  userId: string
): Promise<IdentityVerification[]> {
  return await db
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

export const getSelectedVerification = cache(
  async function getSelectedVerification(
    userId: string
  ): Promise<IdentityVerification | null> {
    const verifications = await getVerificationsByUserId(userId);

    if (verifications.length === 0) {
      return null;
    }

    // NFC chip verifications are always "selected" if verified — no proof/claim check needed
    for (const v of verifications) {
      if (isChipVerified(v)) {
        return v;
      }
    }

    // OCR path — need proof and claim data to rank verifications
    const [proofRows, claimRows] = await Promise.all([
      db
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
      db
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

    for (const v of verifications) {
      if (v.status !== "verified") {
        continue;
      }
      const proofSessions = proofTypesByVerificationSession.get(v.id);
      const hasCompleteProofSession = Boolean(
        proofSessions &&
          [...proofSessions.values()].some((proofs) =>
            hasAll(proofs, requiredProofs)
          )
      );
      const claims = claimTypesByVerification.get(v.id);
      if (hasCompleteProofSession && hasAll(claims, requiredClaims)) {
        return v;
      }
    }

    for (const v of verifications) {
      if (v.status === "verified") {
        return v;
      }
    }

    return verifications.find((v) => v.status !== "revoked") ?? null;
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
  const insertValues: typeof identityBundles.$inferInsert = {
    userId: data.userId,
    walletAddress: data.walletAddress ?? null,
    status: data.status ?? "pending",
    policyVersion: data.policyVersion ?? null,
    issuerId: data.issuerId ?? null,
    attestationExpiresAt: data.attestationExpiresAt ?? null,
    fheKeyId: data.fheKeyId ?? null,
    fheStatus: data.fheStatus ?? null,
    fheError: data.fheError ?? null,
  };

  const updateSet: Record<string, unknown> = {
    updatedAt: sql`datetime('now')`,
  };

  if (data.walletAddress !== undefined) {
    updateSet.walletAddress = data.walletAddress;
  }
  if (data.status !== undefined) {
    updateSet.status = data.status;
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

  await db
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

export async function createVerification(
  data: Omit<NewIdentityVerification, "createdAt" | "updatedAt">
): Promise<void> {
  await db
    .insert(identityVerifications)
    .values({
      ...data,
    })
    .run();
}

export async function upsertVerification(
  data: Omit<NewIdentityVerification, "createdAt" | "updatedAt">
): Promise<void> {
  const { id: _id, ...updateFields } = data;
  await db
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
  reason: string
): Promise<{ revokedVerifications: number; revokedCredentials: number }> {
  const now = new Date().toISOString();
  let revokedVerifications = 0;
  let revokedCredentials = 0;

  await db.transaction(async (tx) => {
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

    // Step 2: Revoke the identity bundle
    await tx
      .update(identityBundles)
      .set({
        status: "revoked",
        revokedAt: now,
        revokedBy,
        revokedReason: reason,
        updatedAt: now,
      })
      .where(
        and(
          eq(identityBundles.userId, userId),
          ne(identityBundles.status, "revoked")
        )
      )
      .run();

    // Step 3: Revoke OID4VCI issued credentials (status 0 → 1)
    const { oidc4vciIssuedCredentials } = await import(
      "../schema/oidc-credentials"
    );
    const credResult = await tx
      .update(oidc4vciIssuedCredentials)
      .set({
        status: 1,
        revokedAt: new Date(),
      })
      .where(
        and(
          eq(oidc4vciIssuedCredentials.userId, userId),
          eq(oidc4vciIssuedCredentials.status, 0)
        )
      )
      .run();
    revokedCredentials = credResult.rowsAffected;

    // Step 4: Remove push subscriptions (device identifiers)
    await tx
      .delete(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, userId))
      .run();
  });

  // Step 4: Revoke on-chain attestations (best-effort, outside transaction)
  const attestations = await db
    .select({
      id: blockchainAttestations.id,
      walletAddress: blockchainAttestations.walletAddress,
      networkId: blockchainAttestations.networkId,
    })
    .from(blockchainAttestations)
    .where(
      and(
        eq(blockchainAttestations.userId, userId),
        inArray(blockchainAttestations.status, ["pending", "confirmed"])
      )
    )
    .all();

  for (const attestation of attestations) {
    let onChainRevoked = false;

    if (canCreateProvider(attestation.networkId)) {
      try {
        const provider = createProvider(attestation.networkId);
        await provider.revokeAttestation(attestation.walletAddress);
        onChainRevoked = true;
      } catch {
        // On-chain failure → mark as revocation_pending for retry
      }
    }

    await db
      .update(blockchainAttestations)
      .set({
        status: onChainRevoked ? "revoked" : "revocation_pending",
        revokedAt: sql`datetime('now')`,
        updatedAt: sql`datetime('now')`,
      })
      .where(eq(blockchainAttestations.id, attestation.id))
      .run();
  }

  return { revokedVerifications, revokedCredentials };
}
