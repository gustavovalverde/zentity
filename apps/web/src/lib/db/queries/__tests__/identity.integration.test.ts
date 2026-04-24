import crypto from "node:crypto";
import { unlink } from "node:fs/promises";
import { join } from "node:path";

import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { env } from "@/env";
import { POLICY_VERSION } from "@/lib/blockchain/attestation/policy";
import { db } from "@/lib/db/connection";
import {
  createVerification,
  dedupKeyExistsForOtherUser,
  deleteIdentityData,
  getAccountIdentity,
  getIdentityBundleByUserId,
  getLatestVerification,
  hasProfileSecret,
  reconcileIdentityBundle,
  revokeIdentity,
  updateIdentityBundleAttestationState,
  upsertIdentityBundle,
  upsertVerification,
} from "@/lib/db/queries/identity";
import {
  createProofSession,
  insertProofArtifact,
  insertSignedClaim,
} from "@/lib/db/queries/privacy";
import {
  identityBundles,
  identityValidityEvents,
  identityVerifications,
} from "@/lib/db/schema/identity";
import { encryptedSecrets, secretWrappers } from "@/lib/db/schema/privacy";
import { recordValidityTransition } from "@/lib/identity/validity/transition";
import {
  computeSecretBlobRef,
  writeSecretBlob,
} from "@/lib/privacy/secrets/storage.server";
import { createTestUser, resetDatabase } from "@/test-utils/db-test-utils";

describe("identity queries", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("upserts bundle validity and updates attestation state", async () => {
    const userId = await createTestUser();

    await upsertIdentityBundle({
      userId,
      walletAddress: "0xabc",
      validityStatus: "pending",
      policyVersion: "policy-v1",
    });

    const initial = await getIdentityBundleByUserId(userId);
    expect(initial?.effectiveVerificationId).toBeNull();
    expect(initial?.walletAddress).toBe("0xabc");
    expect(initial?.validityStatus).toBe("pending");
    expect(initial?.policyVersion).toBe("policy-v1");

    await updateIdentityBundleAttestationState({
      userId,
      policyVersion: "policy-v2",
      issuerId: "issuer-1",
      attestationExpiresAt: "2025-01-01T00:00:00Z",
    });

    const updated = await getIdentityBundleByUserId(userId);
    expect(updated?.validityStatus).toBe("pending");
    expect(updated?.policyVersion).toBe("policy-v2");
    expect(updated?.issuerId).toBe("issuer-1");
    expect(updated?.attestationExpiresAt).toBe("2025-01-01T00:00:00Z");
  });

  it("does not treat profile secret metadata as usable when the blob is missing", async () => {
    const userId = await createTestUser();
    const secretId = crypto.randomUUID();

    await db.insert(encryptedSecrets).values({
      id: secretId,
      userId,
      secretType: "profile",
      encryptedBlob: "",
      blobRef: computeSecretBlobRef(secretId),
      blobHash: "0".repeat(64),
      blobSize: 7,
      metadata: JSON.stringify({ envelopeFormat: "json" }),
    });
    await db.insert(secretWrappers).values({
      id: crypto.randomUUID(),
      secretId,
      userId,
      credentialId: "credential-1",
      wrappedDek: "wrapped-dek",
      prfSalt: "salt",
      kekSource: "prf",
    });

    expect(await hasProfileSecret(userId)).toBe(false);
  });

  it("treats profile secret metadata as usable when the blob exists", async () => {
    const userId = await createTestUser();
    const secretId = crypto.randomUUID();
    const blobRef = computeSecretBlobRef(secretId);

    try {
      await writeSecretBlob({
        secretId,
        body: new Response("profile").body as ReadableStream<Uint8Array>,
      });
      await db.insert(encryptedSecrets).values({
        id: secretId,
        userId,
        secretType: "profile",
        encryptedBlob: "",
        blobRef,
        blobHash: "0".repeat(64),
        blobSize: 7,
        metadata: JSON.stringify({ envelopeFormat: "json" }),
      });
      await db.insert(secretWrappers).values({
        id: crypto.randomUUID(),
        secretId,
        userId,
        credentialId: "credential-1",
        wrappedDek: "wrapped-dek",
        prfSalt: "salt",
        kekSource: "prf",
      });

      expect(await hasProfileSecret(userId)).toBe(true);
    } finally {
      await unlink(join(env.SECRET_BLOB_DIR, `${blobRef}.bin`)).catch(
        () => undefined
      );
    }
  });

  it("freezes the RP nullifier seed while promoting a newer verified NFC credential", async () => {
    const userId = await createTestUser();
    const ocrVerificationId = crypto.randomUUID();
    const nfcVerificationId = crypto.randomUUID();

    await upsertIdentityBundle({
      userId,
      validityStatus: "pending",
    });

    await createVerification({
      id: ocrVerificationId,
      userId,
      method: "ocr",
      status: "verified",
      dedupKey: "dedup-seed-ocr",
      nullifierSeed: "seed-ocr",
      documentHash: "hash-ocr",
      verifiedAt: "2025-01-01T00:00:00Z",
    });
    await reconcileIdentityBundle(userId);

    const seededBundle = await getIdentityBundleByUserId(userId);
    const seededVerification = await db
      .select()
      .from(identityVerifications)
      .where(eq(identityVerifications.id, ocrVerificationId))
      .get();

    expect(seededBundle?.effectiveVerificationId).toBe(ocrVerificationId);
    expect(seededBundle?.nullifierSeed).toBe("seed-ocr");
    expect(seededBundle?.validityStatus).toBe("verified");
    expect(seededVerification?.method).toBe("ocr");

    await createVerification({
      id: nfcVerificationId,
      userId,
      method: "nfc_chip",
      status: "verified",
      chipNullifier: "nfc-credential-123",
      nullifierSeed: "seed-nfc",
      verifiedAt: "2025-02-01T00:00:00Z",
    });
    await reconcileIdentityBundle(userId);

    const accountIdentity = await getAccountIdentity(userId);
    const promotedBundle = await getIdentityBundleByUserId(userId);
    const promotedVerification = await db
      .select()
      .from(identityVerifications)
      .where(eq(identityVerifications.id, nfcVerificationId))
      .get();

    expect(accountIdentity.effectiveVerification?.id).toBe(nfcVerificationId);
    expect(accountIdentity.groupedCredentials).toHaveLength(2);
    expect(promotedBundle?.effectiveVerificationId).toBe(nfcVerificationId);
    // First-write-wins: seed frozen to the OCR verification even after NFC promotion
    expect(promotedBundle?.nullifierSeed).toBe("seed-ocr");
    expect(promotedBundle?.validityStatus).toBe("verified");
    expect(promotedVerification?.method).toBe("nfc_chip");
  });

  it("does not seed the RP nullifier from failed or pending credentials before a verification succeeds", async () => {
    const userId = await createTestUser();
    const failedVerificationId = crypto.randomUUID();
    const verifiedVerificationId = crypto.randomUUID();

    await createVerification({
      id: failedVerificationId,
      userId,
      method: "ocr",
      status: "failed",
      dedupKey: "dedup-failed-attempt",
      documentHash: "hash-failed",
    });

    await getAccountIdentity(userId);

    const beforeVerifiedBundle = await db
      .select()
      .from(identityBundles)
      .where(eq(identityBundles.userId, userId))
      .get();
    expect(beforeVerifiedBundle).toBeUndefined();

    await createVerification({
      id: verifiedVerificationId,
      userId,
      method: "ocr",
      status: "verified",
      dedupKey: "dedup-verified-attempt",
      nullifierSeed: "seed-verified-attempt",
      documentHash: "hash-verified",
      verifiedAt: "2025-03-01T00:00:00Z",
    });
    await reconcileIdentityBundle(userId);

    const afterVerifiedBundle = await db
      .select()
      .from(identityBundles)
      .where(eq(identityBundles.userId, userId))
      .get();
    expect(afterVerifiedBundle?.nullifierSeed).toBe("seed-verified-attempt");
    expect(afterVerifiedBundle?.effectiveVerificationId).toBe(
      verifiedVerificationId
    );
  });

  it("freezes the original OCR dedup key when a pending verification is promoted to verified", async () => {
    const userId = await createTestUser();
    const verificationId = crypto.randomUUID();

    await upsertIdentityBundle({
      userId,
      validityStatus: "pending",
    });

    await createVerification({
      id: verificationId,
      userId,
      method: "ocr",
      status: "pending",
      dedupKey: "dedup-promoted-ocr",
      nullifierSeed: "seed-promoted-ocr",
      documentHash: "hash-promoted-ocr",
    });

    await upsertVerification({
      id: verificationId,
      userId,
      method: "ocr",
      status: "verified",
      verifiedAt: "2025-05-01T00:00:00Z",
      documentHash: "hash-promoted-ocr",
    });
    await reconcileIdentityBundle(userId);

    const [bundle, verification] = await Promise.all([
      getIdentityBundleByUserId(userId),
      db
        .select()
        .from(identityVerifications)
        .where(eq(identityVerifications.id, verificationId))
        .get(),
    ]);

    expect(bundle?.validityStatus).toBe("verified");
    expect(bundle?.effectiveVerificationId).toBe(verificationId);
    expect(bundle?.nullifierSeed).toBe("seed-promoted-ocr");
    expect(verification?.status).toBe("verified");
    expect(verification?.dedupKey).toBe("dedup-promoted-ocr");
  });

  it("returns latest verified identity document", async () => {
    const userId = await createTestUser();
    const olderDoc = crypto.randomUUID();
    const newerDoc = crypto.randomUUID();

    await createVerification({
      id: olderDoc,
      userId,
      method: "ocr",
      documentHash: "hash-old",
      nameCommitment: "commit-old",
      verifiedAt: "2024-01-01T00:00:00Z",
      confidenceScore: 0.9,
      status: "verified",
    });

    await createVerification({
      id: newerDoc,
      userId,
      method: "ocr",
      documentHash: "hash-new",
      dedupKey: "dedup-latest",
      nameCommitment: "commit-new",
      verifiedAt: "2025-01-01T00:00:00Z",
      confidenceScore: 0.95,
      status: "verified",
    });

    const latest = await getLatestVerification(userId);
    expect(latest?.id).toBe(newerDoc);
    // Dedup key: same user re-verifying is allowed, other user is blocked
    const otherUser = await createTestUser({ email: "other@test.com" });
    await expect(
      dedupKeyExistsForOtherUser("dedup-latest", userId)
    ).resolves.toBe(false);
    await expect(
      dedupKeyExistsForOtherUser("dedup-latest", otherUser)
    ).resolves.toBe(true);
  });

  it("allows same-user re-verification with the same dedup key", async () => {
    const userId = await createTestUser();
    const originalId = crypto.randomUUID();
    const reverifyId = crypto.randomUUID();

    await createVerification({
      id: originalId,
      userId,
      method: "ocr",
      documentHash: "hash-original",
      dedupKey: "dedup-repeat",
      status: "verified",
      verifiedAt: "2025-01-01T00:00:00Z",
    });

    await createVerification({
      id: reverifyId,
      userId,
      method: "ocr",
      documentHash: "hash-reverify",
      dedupKey: "dedup-repeat",
      status: "pending",
    });

    const rows = await db
      .select()
      .from(identityVerifications)
      .where(eq(identityVerifications.userId, userId))
      .all();

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.id)).toEqual(
      expect.arrayContaining([originalId, reverifyId])
    );
  });

  it("deletes validity history alongside other identity data", async () => {
    const userId = await createTestUser();
    const verificationId = crypto.randomUUID();

    await createVerification({
      id: verificationId,
      userId,
      method: "ocr",
      status: "verified",
      dedupKey: "dedup-delete-history",
      documentHash: "hash-delete-history",
      verifiedAt: "2025-04-01T00:00:00Z",
    });

    await reconcileIdentityBundle(userId);
    await revokeIdentity(userId, "admin@zentity.app", "cleanup", "admin");
    await deleteIdentityData(userId);

    const [bundle, verification, revocationEvent] = await Promise.all([
      db
        .select()
        .from(identityBundles)
        .where(eq(identityBundles.userId, userId))
        .get(),
      db
        .select()
        .from(identityVerifications)
        .where(eq(identityVerifications.userId, userId))
        .get(),
      db
        .select()
        .from(identityValidityEvents)
        .where(eq(identityValidityEvents.userId, userId))
        .get(),
    ]);

    expect(bundle).toBeUndefined();
    expect(verification).toBeUndefined();
    expect(revocationEvent).toBeUndefined();
  });

  it("promotes a newer OCR credential only when its proof set completes and records supersession atomically", async () => {
    const userId = await createTestUser();
    const originalVerificationId = crypto.randomUUID();
    const replacementVerificationId = crypto.randomUUID();

    async function attachCompleteOcrEvidence(
      verificationId: string,
      issuedAt: string
    ) {
      for (const claimType of [
        "ocr_result",
        "liveness_score",
        "face_match_score",
      ]) {
        await insertSignedClaim({
          id: crypto.randomUUID(),
          userId,
          verificationId,
          claimType,
          claimPayload: "{}",
          signature: "sig",
          issuedAt,
        });
      }

      const proofSessionId = crypto.randomUUID();
      const createdAt = Date.parse(issuedAt);
      await createProofSession({
        id: proofSessionId,
        userId,
        verificationId,
        msgSender: userId,
        audience: "http://localhost:3000",
        policyVersion: POLICY_VERSION,
        createdAt,
        expiresAt: createdAt + 60_000,
      });

      for (const proofType of [
        "age_verification",
        "doc_validity",
        "nationality_membership",
        "face_match",
        "identity_binding",
      ]) {
        await insertProofArtifact({
          id: crypto.randomUUID(),
          userId,
          verificationId,
          proofSessionId,
          proofSystem: "noir_ultrahonk",
          proofType,
          proofHash: `${verificationId}-${proofType}`,
          policyVersion: POLICY_VERSION,
          verified: true,
        });
      }
    }

    await createVerification({
      id: originalVerificationId,
      userId,
      method: "ocr",
      status: "verified",
      dedupKey: "dedup-original-proof-set",
      documentHash: "hash-original-proof-set",
      verifiedAt: "2025-01-01T00:00:00Z",
    });
    await attachCompleteOcrEvidence(
      originalVerificationId,
      "2025-01-01T00:00:00Z"
    );
    await reconcileIdentityBundle(userId);

    await createVerification({
      id: replacementVerificationId,
      userId,
      method: "ocr",
      status: "verified",
      dedupKey: "dedup-replacement-proof-set",
      documentHash: "hash-replacement-proof-set",
      verifiedAt: "2025-02-01T00:00:00Z",
    });
    await reconcileIdentityBundle(userId);

    const bundleBeforeReplacementProofs =
      await getIdentityBundleByUserId(userId);
    expect(bundleBeforeReplacementProofs?.effectiveVerificationId).toBe(
      originalVerificationId
    );

    await db.transaction(async (tx) => {
      for (const claimType of [
        "ocr_result",
        "liveness_score",
        "face_match_score",
      ]) {
        await insertSignedClaim(
          {
            id: crypto.randomUUID(),
            userId,
            verificationId: replacementVerificationId,
            claimType,
            claimPayload: "{}",
            signature: "sig",
            issuedAt: "2025-02-01T00:00:00Z",
          },
          tx
        );
      }

      const proofSessionId = crypto.randomUUID();
      const createdAt = Date.parse("2025-02-01T00:00:00Z");
      await createProofSession(
        {
          id: proofSessionId,
          userId,
          verificationId: replacementVerificationId,
          msgSender: userId,
          audience: "http://localhost:3000",
          policyVersion: POLICY_VERSION,
          createdAt,
          expiresAt: createdAt + 60_000,
        },
        tx
      );

      for (const proofType of [
        "age_verification",
        "doc_validity",
        "nationality_membership",
        "face_match",
        "identity_binding",
      ]) {
        await insertProofArtifact(
          {
            id: crypto.randomUUID(),
            userId,
            verificationId: replacementVerificationId,
            proofSessionId,
            proofSystem: "noir_ultrahonk",
            proofType,
            proofHash: `${replacementVerificationId}-${proofType}`,
            policyVersion: POLICY_VERSION,
            verified: true,
          },
          tx
        );
      }

      const reconcileResult = await reconcileIdentityBundle(userId, tx);
      expect(reconcileResult.credentialSuperseded).toBe(true);
      expect(reconcileResult.effectiveVerificationId).toBe(
        replacementVerificationId
      );

      await recordValidityTransition({
        executor: tx,
        userId,
        verificationId: replacementVerificationId,
        eventKind: "superseded",
        source: "system",
        occurredAt: "2025-02-01T00:00:01Z",
      });
    });

    const [bundle, accountIdentity, originalVerification, validityEvent] =
      await Promise.all([
        getIdentityBundleByUserId(userId),
        getAccountIdentity(userId),
        db
          .select()
          .from(identityVerifications)
          .where(eq(identityVerifications.id, originalVerificationId))
          .get(),
        db
          .select()
          .from(identityValidityEvents)
          .where(eq(identityValidityEvents.userId, userId))
          .orderBy(identityValidityEvents.createdAt)
          .get(),
      ]);

    expect(bundle?.effectiveVerificationId).toBe(replacementVerificationId);
    expect(accountIdentity.effectiveVerification?.id).toBe(
      replacementVerificationId
    );
    expect(originalVerification?.supersededByVerificationId).toBe(
      replacementVerificationId
    );
    expect(originalVerification?.supersededAt).not.toBeNull();
    expect(validityEvent).toEqual(
      expect.objectContaining({
        verificationId: replacementVerificationId,
        eventKind: "superseded",
        validityStatus: "verified",
        source: "system",
      })
    );
  });
});
