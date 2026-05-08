import crypto from "node:crypto";

import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { POLICY_VERSION } from "@/lib/blockchain/attestation/policy";
import { db } from "@/lib/db/connection";
import {
  attachHumanityCredential,
  detachHumanityCredential,
} from "@/lib/db/queries/humanity";
import {
  createVerification,
  reconcileIdentityBundle,
  revokeIdentity,
  upsertIdentityBundle,
} from "@/lib/db/queries/identity";
import {
  createProofSession,
  insertProofArtifact,
  insertSignedClaim,
} from "@/lib/db/queries/privacy";
import { verificationChecks } from "@/lib/db/schema/privacy";
import {
  materializeVerificationChecks,
  rematerializeAllUserVerifications,
} from "@/lib/identity/verification/materialize";
import { getVerificationReadModel } from "@/lib/identity/verification/read-model";
import { createTestUser, resetDatabase } from "@/test-utils/db-test-utils";

async function seedFullOcrVerification(userId: string): Promise<string> {
  const verificationId = crypto.randomUUID();
  await createVerification({
    id: verificationId,
    userId,
    method: "ocr",
    status: "verified",
    documentHash: `doc-${crypto.randomUUID()}`,
    verifiedAt: new Date().toISOString(),
  });
  await reconcileIdentityBundle(userId);

  const proofSessionId = crypto.randomUUID();
  const now = Date.now();
  await createProofSession({
    id: proofSessionId,
    userId,
    verificationId,
    msgSender: userId,
    audience: "http://localhost:3000",
    policyVersion: POLICY_VERSION,
    createdAt: now,
    expiresAt: now + 60_000,
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
      proofHash: crypto.randomBytes(32).toString("hex"),
      proofPayload: crypto.randomBytes(64).toString("hex"),
      policyVersion: POLICY_VERSION,
      verified: true,
    });
  }

  await insertSignedClaim({
    id: crypto.randomUUID(),
    userId,
    verificationId,
    claimType: "liveness_score",
    claimPayload: JSON.stringify({ score: 1 }),
    signature: crypto.randomBytes(64).toString("hex"),
    issuedAt: new Date().toISOString(),
  });

  return verificationId;
}

async function getSybilCheck(verificationId: string) {
  return await db
    .select({
      evidenceRef: verificationChecks.evidenceRef,
      passed: verificationChecks.passed,
      source: verificationChecks.source,
    })
    .from(verificationChecks)
    .where(
      and(
        eq(verificationChecks.verificationId, verificationId),
        eq(verificationChecks.checkType, "sybil_resistant")
      )
    )
    .get();
}

describe("verification read model", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("returns grouped identity with a deterministic effective credential", async () => {
    const userId = await createTestUser();
    const ocrVerificationId = crypto.randomUUID();
    const nfcVerificationId = crypto.randomUUID();

    await createVerification({
      id: ocrVerificationId,
      userId,
      method: "ocr",
      status: "verified",
      dedupKey: "dedup-grouped-ocr",
      documentHash: "hash-ocr",
      verifiedAt: "2026-04-20T09:00:00Z",
    });

    await createVerification({
      id: nfcVerificationId,
      userId,
      method: "nfc_chip",
      status: "verified",
      chipNullifier: "nullifier-grouped-nfc",
      verifiedAt: "2026-04-20T10:00:00Z",
    });
    await reconcileIdentityBundle(userId);

    const model = await getVerificationReadModel(userId);

    expect(model.groupedIdentity.effectiveVerificationId).toBe(
      nfcVerificationId
    );
    expect(model.groupedIdentity.credentials).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          credentialId: ocrVerificationId,
          method: "ocr",
          isEffective: false,
        }),
        expect.objectContaining({
          credentialId: nfcVerificationId,
          method: "nfc_chip",
          isEffective: true,
        }),
      ])
    );
  });

  it("flags humanity.proven for an account with only a humanity credential", async () => {
    const userId = await createTestUser();
    await upsertIdentityBundle({ userId });
    await attachHumanityCredential({
      userId,
      provider: "world_id_orb",
      providerSubjectKind: "nullifier",
      providerSubjectHash: "subject-hash-read-model",
    });

    const model = await getVerificationReadModel(userId);

    expect(model.verificationId).toBeNull();
    expect(model.compliance.identity.verified).toBe(false);
    expect(model.compliance.identity.strength).toBe("none");
    expect(model.compliance.humanity.proven).toBe(true);
    expect(model.compliance.policy.checks.sybilResistant).toBe(true);
    expect(model.humanityCredentials).toHaveLength(1);
    expect(model.humanityCredentials[0]?.provider).toBe("world_id_orb");
  });

  it("rematerializes sybil resistance when a humanity credential is detached", async () => {
    const userId = await createTestUser();
    const verificationId = await seedFullOcrVerification(userId);
    await attachHumanityCredential({
      userId,
      provider: "world_id_orb",
      providerSubjectKind: "nullifier",
      providerSubjectHash: "subject-hash-detach-rematerialize",
    });
    await materializeVerificationChecks(userId, verificationId);

    await expect(getSybilCheck(verificationId)).resolves.toMatchObject({
      passed: true,
      source: "humanity_signal",
    });

    await detachHumanityCredential({ userId, provider: "world_id_orb" });
    await rematerializeAllUserVerifications(userId);

    await expect(getSybilCheck(verificationId)).resolves.toMatchObject({
      passed: false,
      source: "none",
      evidenceRef: null,
    });
    const model = await getVerificationReadModel(userId);
    expect(model.compliance.identity.verified).toBe(false);
    expect(model.compliance.humanity.proven).toBe(false);
    expect(model.compliance.policy.checks.sybilResistant).toBe(false);
  });

  it("excludes expired humanity credentials when materializing sybil resistance", async () => {
    const userId = await createTestUser();
    const verificationId = await seedFullOcrVerification(userId);
    await attachHumanityCredential({
      userId,
      provider: "world_id_orb",
      providerSubjectKind: "nullifier",
      providerSubjectHash: "subject-hash-expired-materialize",
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });

    await materializeVerificationChecks(userId, verificationId);

    await expect(getSybilCheck(verificationId)).resolves.toMatchObject({
      passed: false,
      source: "none",
      evidenceRef: null,
    });
    const model = await getVerificationReadModel(userId);
    expect(model.humanityCredentials).toHaveLength(0);
    expect(model.compliance.humanity.proven).toBe(false);
    expect(model.compliance.policy.checks.sybilResistant).toBe(false);
  });

  it("does not count humanity for users whose identity bundle is revoked", async () => {
    const userId = await createTestUser();
    await upsertIdentityBundle({ userId });
    await attachHumanityCredential({
      userId,
      provider: "world_id_orb",
      providerSubjectKind: "nullifier",
      providerSubjectHash: "subject-hash-revoked-read-model",
    });

    await revokeIdentity(userId, "admin@zentity.app", "fraud", "admin");

    const model = await getVerificationReadModel(userId);

    expect(model.verificationId).toBeNull();
    expect(model.bundle.validityStatus).toBe("revoked");
    // revokeIdentity cascades into humanity_credentials, so the active
    // set is empty and the read model surfaces no providers.
    expect(model.humanityCredentials).toHaveLength(0);
    expect(model.compliance.identity.verified).toBe(false);
    expect(model.compliance.humanity.proven).toBe(false);
    expect(model.compliance.policy.checks.sybilResistant).toBe(false);
  });
});
